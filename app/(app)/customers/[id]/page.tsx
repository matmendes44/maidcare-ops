import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  FilePlus2,
  FileSignature,
  List,
  Mail,
  Pencil,
  Plus,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "cn";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { isStripeConfigured, stripeDashboardUrl } from "@/lib/stripe";
import { DeleteCustomerButton } from "../delete-customer-button";
import { StripeSyncButton } from "../stripe-sync-button";
import { getInvoices, parseFilters } from "../../finances/data";
import { InvoiceTable } from "../../finances/invoice-table";
import { statusVariant as appointmentStatusVariant } from "../../appointments/options";
import { AddContact } from "../add-contact";
import { getAdjacentCustomers, getCustomerDetail, parseCustomerId } from "../data";
import { displayName, formatPhone } from "../options";
import { statusVariant } from "../status";
import { RecordTabs } from "@/components/record-tabs";
import { RecurringSection } from "../recurring-section";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Empty,
  Field,
  FieldColumn,
  FieldGroup,
  RecordType,
  TableFrame,
  Toolbar,
  linkClass,
} from "@/components/record";

// Which tab to open after a save, so the change is in view.
const savedTabs: Record<string, string> = { property: "properties", contact: "contacts" };

const link = linkClass;

async function CustomerRecord({
  params,
  searchParams,
}: Pick<PageProps<"/customers/[id]">, "params" | "searchParams">) {
  const id = parseCustomerId((await params).id);
  const customer = id === null ? null : await getCustomerDetail(id);
  if (!customer) notFound();
  const [{ saved, stripe: stripeParam, invSort, invDir }, { prevId, nextId }, { t, fmt, tr }, user] = await Promise.all([
    searchParams,
    getAdjacentCustomers(customer.customerCode, customer.status === "lead"),
    getI18n(),
    getCurrentUser(),
  ]);
  // their invoices, first page; newest first unless a column header was
  // clicked (invSort / invDir in the URL)
  const invoiceFilters = parseFilters({ sort: invSort, dir: invDir });
  const customerInvoices = await getInvoices(invoiceFilters, customer.id);
  const savedMessages: Record<string, string> = t.customers.saved;
  const dash = t.common.none;

  const name = displayName(customer);
  const billing = customer.properties.find((p) => p.id === customer.billingPropertyId);
  const primary = customer.contacts.find((ct) => ct.isPrimary);
  const otherPhones = customer.contacts.filter((ct) => ct !== primary && ct.phone);
  const email = customer.email ?? primary?.email ?? null;
  const savedKey = typeof saved === "string" ? saved : "";
  // sorting invoices reloads the page, so stay on their tab
  const defaultTab = savedTabs[savedKey] ?? (invSort ? "invoices" : "contacts");

  const navButton = "size-9 text-muted-foreground hover:text-foreground";
  const listHref = customer.status === "lead" ? "/leads" : "/customers";

  return (
    <>
      {/* Record header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={UserRound}>{customer.status === "lead" ? tr("customer|Lead") : t.customers.record}</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold">
            <span>
              <span className="text-muted-foreground">{customer.customerCode}</span> {name}
            </span>
            <Badge variant={statusVariant[customer.status]} className="h-7 px-3 text-[0.8rem]">
              {t.enums.customerStatus[customer.status]}
            </Badge>
          </h1>
        </div>
        <nav aria-label={t.customers.navLabel} className="flex items-center gap-1">
          {prevId ? (
            <Link
              href={`/customers/${prevId}`}
              className={buttonVariants({ variant: "ghost", size: "icon", className: navButton })}
              aria-label={t.record.previous(t.customers.previousWhat)}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
          ) : (
            <span className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "opacity-30")} aria-hidden="true">
              <ArrowLeft />
            </span>
          )}
          {nextId ? (
            <Link
              href={`/customers/${nextId}`}
              className={buttonVariants({ variant: "ghost", size: "icon", className: navButton })}
              aria-label={t.record.next(t.customers.previousWhat)}
            >
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : (
            <span className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "opacity-30")} aria-hidden="true">
              <ArrowRight />
            </span>
          )}
          <Link href={listHref} className={buttonVariants({ variant: "ghost", className: "text-muted-foreground" })}>
            <List aria-hidden="true" />
            {t.common.list}
          </Link>
        </nav>
      </div>

      {/* Action bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
        <Link href={`/customers/${customer.id}/edit`} className={buttonVariants()}>
          <Pencil aria-hidden="true" />
          {t.common.edit}
        </Link>
        <Link href={listHref} className={buttonVariants({ variant: "outline" })}>
          {t.common.back}
        </Link>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <Link href={`/appointments/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline" })}>
          <CalendarPlus aria-hidden="true" />
          {t.customers.newAppointment}
        </Link>
        {can(user, "quotes.manage") && (
          <Link href={`/finances/estimates/quick?customer=${customer.id}`} className={buttonVariants({ variant: "outline" })}>
            <FileSignature aria-hidden="true" />
            {tr("New estimate")}
          </Link>
        )}
        {can(user, "invoices.create") && (
          <Link href={`/finances/invoices/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline" })}>
            <FilePlus2 aria-hidden="true" />
            {tr("New invoice")}
          </Link>
        )}
        <Link
          href={`/properties/new?customer=${customer.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          <Plus aria-hidden="true" />
          {t.customers.addProperty}
        </Link>
        {email && (
          <a href={`mailto:${email}`} className={buttonVariants({ variant: "outline" })}>
            <Mail aria-hidden="true" />
            {t.customers.email}
          </a>
        )}
        {can(user, "customers.delete") && (
          <>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <DeleteCustomerButton
              customerId={customer.id}
              customerCode={customer.customerCode}
              name={name}
              inStripe={Boolean(customer.stripeCustomerId)}
            />
          </>
        )}
      </div>

      {stripeParam === "synced" && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {tr("Stripe is up to date.")}
        </p>
      )}
      {customer.stripeCustomerId && customer.stripeSyncError && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p>
            <span className="font-semibold">{tr("Stripe has out-of-date details for this customer.")}</span>{" "}
            {customer.stripeSyncError}
          </p>
          {can(user, "stripe.manage") && <StripeSyncButton customerId={customer.id} mode="sync" />}
        </div>
      )}
      {stripeParam === "created" && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {tr("Created in Stripe.")}
        </p>
      )}
      {/* leads are added to Stripe when they're first invoiced */}
      {!customer.stripeCustomerId && isStripeConfigured() && (customer.status !== "lead" || stripeParam === "failed") && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p>
            {stripeParam === "failed"
              ? tr("The customer was saved, but creating them in Stripe failed.")
              : tr("This customer isn't in Stripe yet, so they can't be invoiced or charged.")}
          </p>
          {can(user, "stripe.manage") && <StripeSyncButton customerId={customer.id} />}
        </div>
      )}
      {savedMessages[savedKey] && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {savedMessages[savedKey]}
        </p>
      )}

      <div className="mt-6">
        <FieldGroup title={t.record.primaryInfo}>
          <FieldColumn>
            <Field label={t.customers.detail.customerId}>
              <span className="font-mono">{customer.customerCode}</span>
            </Field>
            <Field label={t.customers.detail.name}>{[customer.firstName, customer.lastName].filter(Boolean).join(" ")}</Field>
            <Field label={t.customers.fields.companyName}>{customer.companyName}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.fields.type}>{t.enums.customerType[customer.type]}</Field>
            <Field label={t.customers.fields.status}>{t.enums.customerStatus[customer.status]}</Field>
            <Field label={t.customers.detail.referredBy}>
              {customer.customer && (
                <Link href={`/customers/${customer.customer.id}`} className={link}>
                  {customer.customer.customerCode} {displayName(customer.customer)}
                </Link>
              )}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.fields.startDate}>{fmt.calendarDate(customer.startDate)}</Field>
            <Field label={t.customers.fields.endDate}>{customer.endDate && fmt.calendarDate(customer.endDate)}</Field>
            {customer.status === "inactive" && (
              <Field label={t.customers.fields.endReasons}>
                {customer.endReasons.map((r) => t.enums.endReason[r]).join(", ")}
              </Field>
            )}
            {customer.customers.length > 0 && (
              <Field label={t.customers.detail.theyReferred}>
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {customer.customers.map((r) => (
                    <Link key={r.id} href={`/customers/${r.id}`} className={link}>
                      {displayName(r)}
                    </Link>
                  ))}
                </span>
              </Field>
            )}
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.detail.totalPaid}>
              <span className="font-semibold tabular-nums">
                {fmt.money(customer.totals.paidCents)}
              </span>
              <span className="text-muted-foreground"> · {t.customers.detail.payments(customer.totals.paymentCount)}</span>
            </Field>
            {can(user, "stripe.manage") && (
            <Field label={t.customers.fields.stripeCustomerId}>
              {customer.stripeCustomerId && (
                <a
                  href={stripeDashboardUrl(`customers/${customer.stripeCustomerId}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(link, "font-mono text-[0.85rem] break-all")}
                  title={tr("Open in Stripe")}
                >
                  {customer.stripeCustomerId}
                </a>
              )}
            </Field>
            )}
            <Field label={t.customers.fields.notes}>
              {customer.notes && <span className="whitespace-pre-wrap">{customer.notes}</span>}
            </Field>
          </FieldColumn>
        </FieldGroup>

        <FieldGroup title={t.customers.detail.contactInfo}>
          <FieldColumn>
            <Field label={t.customers.fields.billingPropertyId}>
              {billing && (
                <>
                  {billing.street}
                  {billing.unit && `, ${billing.unit}`}
                  <br />
                  {billing.city}, {billing.state} {billing.zip}
                </>
              )}
            </Field>
            <Field label={t.customers.detail.textMessages}>
              {primary && (primary.smsOptIn ? t.customers.detail.optedIn : t.customers.detail.optedOut)}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.detail.phone}>
              {primary?.phone && (
                <a href={`tel:${primary.phone}`} className={link}>
                  {formatPhone(primary.phone)}
                </a>
              )}
            </Field>
            {otherPhones.map((ct) => (
              <Field key={ct.id} label={ct.role || ct.name || t.customers.detail.otherPhone}>
                <a href={`tel:${ct.phone}`} className={link}>
                  {formatPhone(ct.phone!)}
                </a>
              </Field>
            ))}
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.fields.email}>
              {email && (
                <a href={`mailto:${email}`} className={link}>
                  {email}
                </a>
              )}
            </Field>
            <Field label={t.customers.detail.primaryContact}>{primary?.name}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={t.customers.detail.accessNotes}>
              {billing?.accessNotes && <span className="whitespace-pre-wrap">{billing.accessNotes}</span>}
            </Field>
          </FieldColumn>
        </FieldGroup>
      </div>

      <RecurringSection customerId={customer.id} fmt={fmt} />

      {/* Next keeps visited pages alive and re-renders them on return, and a
          tab bar's starting tab can't change once it's mounted; the key mounts
          a fresh one per customer and starting tab instead. */}
      <RecordTabs
        key={`${customer.id}:${defaultTab}`}
        defaultTab={defaultTab}
        tabs={[
          {
            value: "contacts",
            label: t.customers.tabs.contacts,
            count: customer.contacts.length,
            content: (
              <>
                <Toolbar>
                  {/* remounts (closing the form) once a contact has been added */}
                  <AddContact
                    key={customer.contacts.length}
                    customerId={customer.id}
                    hasPrimary={Boolean(primary)}
                  />
                </Toolbar>
                {customer.contacts.length === 0 ? (
                  <Empty>{t.customers.empty.contacts}</Empty>
                ) : (
                  <TableFrame>
                    <Table stack>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.customers.contactsTable.name}</TableHead>
                          <TableHead>{t.customers.contactsTable.role}</TableHead>
                          <TableHead>{t.customers.contactsTable.phone}</TableHead>
                          <TableHead>{t.customers.contactsTable.email}</TableHead>
                          <TableHead>{t.customers.contactsTable.texts}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.contacts.map((ct) => (
                          <TableRow key={ct.id}>
                            <TableCell data-primary>
                              {ct.name ?? dash}
                              {ct.isPrimary && (
                                <Badge variant="info" className="ml-2">{t.customers.contactsTable.primary}</Badge>
                              )}
                            </TableCell>
                            <TableCell data-label={t.customers.contactsTable.role}>{ct.role ?? dash}</TableCell>
                            <TableCell data-label={t.customers.contactsTable.phone}>
                              {ct.phone ? (
                                <a href={`tel:${ct.phone}`} className={link}>{formatPhone(ct.phone)}</a>
                              ) : dash}
                            </TableCell>
                            <TableCell data-label={t.customers.contactsTable.email}>
                              {ct.email ? (
                                <a href={`mailto:${ct.email}`} className={link}>{ct.email}</a>
                              ) : dash}
                            </TableCell>
                            <TableCell data-label={t.customers.contactsTable.texts}>{ct.smsOptIn ? t.customers.detail.optedIn : t.customers.detail.optedOut}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableFrame>
                )}
              </>
            ),
          },
          {
            value: "properties",
            label: t.customers.tabs.properties,
            count: customer.properties.length,
            content: (
              <>
                <Toolbar>
                  <Link
                    href={`/properties/new?customer=${customer.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Plus aria-hidden="true" />
                    {t.customers.addProperty}
                  </Link>
                </Toolbar>
                {customer.properties.length === 0 ? (
                  <Empty>{t.customers.empty.properties}</Empty>
                ) : (
                  <TableFrame>
                    <Table stack>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">{t.customers.propertiesTable.edit}</TableHead>
                          <TableHead>{t.customers.propertiesTable.address}</TableHead>
                          <TableHead>{t.customers.propertiesTable.zone}</TableHead>
                          <TableHead>{t.customers.propertiesTable.status}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.properties.map((p) => {
                          return (
                            <TableRow key={p.id} className="align-top">
                              <TableCell data-actions>
                                {can(user, "properties.edit") && (
                                  <Link
                                    href={`/properties/${p.id}/edit`}
                                    className={link}
                                    aria-label={t.customers.propertiesTable.editLabel(p.street)}
                                  >
                                    {t.customers.propertiesTable.edit}
                                  </Link>
                                )}
                              </TableCell>
                              <TableCell data-primary className="whitespace-normal">
                                <div className="font-medium">
                                  {p.street}
                                  {p.unit && `, ${p.unit}`}
                                </div>
                                <div className="text-[0.8rem] text-muted-foreground">
                                  {p.city}, {p.state} {p.zip}
                                </div>
                                {(p.accessNotes || p.serviceNotes) && (
                                  <div className="mt-1 max-w-md text-[0.8rem] whitespace-pre-wrap text-muted-foreground">
                                    {[p.accessNotes, p.serviceNotes].filter(Boolean).join("\n")}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell data-label={t.customers.propertiesTable.zone}>{p.zone ? t.enums.zone[p.zone] : dash}</TableCell>
                              <TableCell data-label={t.customers.propertiesTable.status}>
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge variant={p.isActive ? "success" : "muted"}>
                                    {p.isActive ? t.customers.propertiesTable.active : t.customers.propertiesTable.inactive}
                                  </Badge>
                                  {p.id === customer.billingPropertyId && (
                                    <Badge variant="info">{t.customers.propertiesTable.billing}</Badge>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableFrame>
                )}
              </>
            ),
          },
          {
            value: "appointments",
            label: t.customers.tabs.appointments,
            content: (
              <>
                <Toolbar>
                  <Link
                    href={`/appointments/new?customer=${customer.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Plus aria-hidden="true" />
                    {t.customers.newAppointment}
                  </Link>
                  {customer.recentVisits.length > 0 && (
                    <span className="text-sm text-muted-foreground">{t.customers.appointmentsTable.recent}</span>
                  )}
                </Toolbar>
                {customer.recentVisits.length === 0 ? (
                  <Empty>{t.customers.empty.appointments}</Empty>
                ) : (
                  <TableFrame>
                    <Table stack>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.customers.appointmentsTable.date}</TableHead>
                          <TableHead>{t.customers.appointmentsTable.time}</TableHead>
                          <TableHead>{t.customers.appointmentsTable.property}</TableHead>
                          <TableHead>{t.customers.appointmentsTable.vehicle}</TableHead>
                          <TableHead>{t.customers.appointmentsTable.status}</TableHead>
                          <TableHead className="text-right">{t.customers.appointmentsTable.price}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.recentVisits.map((v) => (
                          <TableRow key={v.id} className="relative">
                            <TableCell data-primary>
                              <Link
                                href={`/appointments/${v.id}`}
                                className="font-medium after:absolute after:inset-0 hover:text-link focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                              >
                                {fmt.day(v.scheduledStart)}
                              </Link>
                            </TableCell>
                            <TableCell data-label={t.customers.appointmentsTable.time} className="tabular-nums">{fmt.timeRange(v.scheduledStart, v.scheduledEnd)}</TableCell>
                            <TableCell data-label={t.customers.appointmentsTable.property}>{v.street}</TableCell>
                            <TableCell data-label={t.customers.appointmentsTable.vehicle}>{v.vehicleName ?? dash}</TableCell>
                            <TableCell data-label={t.customers.appointmentsTable.status}>
                              <Badge variant={appointmentStatusVariant[v.status]}>{t.enums.appointmentStatus[v.status]}</Badge>
                            </TableCell>
                            <TableCell data-label={t.customers.appointmentsTable.price} className="text-right tabular-nums">{v.priceCents ? fmt.money(v.priceCents) : <span className="text-muted-foreground">{tr("Not invoiced")}</span>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableFrame>
                )}
              </>
            ),
          },
          {
            value: "invoices",
            label: tr("Invoices"),
            count: customerInvoices.total,
            content:
              customerInvoices.total === 0 ? (
                <>
                {can(user, "invoices.create") && (
                <Toolbar>
                  <Link href={`/finances/invoices/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <Plus aria-hidden="true" />
                    {tr("New invoice")}
                  </Link>
                </Toolbar>
                )}
                <Empty>
                  {customer.stripeCustomerId
                    ? tr("No invoices yet. Use Sync with Stripe on the Finances page to bring in existing ones.")
                    : tr("No invoices yet.")}
                </Empty>
                </>
              ) : (
                <>
                  {can(user, "invoices.create") && (
                  <Toolbar>
                    <Link href={`/finances/invoices/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      <Plus aria-hidden="true" />
                      {tr("New invoice")}
                    </Link>
                  </Toolbar>
                  )}
                  <p className="mb-3 text-sm text-muted-foreground">
                    {customerInvoices.total > customerInvoices.rows.length
                      ? `${tr("Showing {shown} of {total}.", { shown: customerInvoices.rows.length, total: customerInvoices.total })} `
                      : ""}
                    <Link href="/finances" className={link}>
                      {tr("All invoices")}
                    </Link>
                  </p>
                  <InvoiceTable
                    rows={customerInvoices.rows}
                    fmt={fmt}
                    showCustomer={false}
                    sort={invoiceFilters.sort}
                    dir={invoiceFilters.dir}
                    sortHref={(k) => {
                      const nextDir = invoiceFilters.sort === k && invoiceFilters.dir === "desc" ? "asc" : "desc";
                      return `/customers/${customer.id}?invSort=${k}&invDir=${nextDir}`;
                    }}
                  />
                </>
              ),
          },
          {
            value: "payments",
            label: t.customers.tabs.payments,
            count: customer.totals.paymentCount,
            content:
              customer.payments.length === 0 ? (
                <Empty>{t.customers.empty.payments}</Empty>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {t.customers.paymentsTable.recent(fmt.money(customer.totals.paidCents))}
                  </p>
                  <TableFrame>
                    <Table stack>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.customers.paymentsTable.date}</TableHead>
                          <TableHead>{t.customers.paymentsTable.method}</TableHead>
                          <TableHead>{t.customers.paymentsTable.payer}</TableHead>
                          <TableHead className="text-right">{t.customers.paymentsTable.amount}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.payments.map((pay) => (
                          <TableRow key={pay.id}>
                            <TableCell data-primary>{fmt.date(pay.paidAt)}</TableCell>
                            <TableCell data-label={t.customers.paymentsTable.method}>{t.enums.payMethod[pay.method]}</TableCell>
                            <TableCell data-label={t.customers.paymentsTable.payer}>{pay.payerName ?? dash}</TableCell>
                            <TableCell data-label={t.customers.paymentsTable.amount} className="text-right tabular-nums">{fmt.money(pay.amountCents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableFrame>
                </>
              ),
          },
          {
            value: "system",
            label: t.record.systemInfo,
            content: (
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t.record.dateCreated}>{fmt.date(customer.createdAt)}</Field>
                <Field label={t.record.lastModified}>{fmt.date(customer.updatedAt)}</Field>
                <Field label={t.record.internalId}>
                  <span className="font-mono">{customer.id}</span>
                </Field>
              </dl>
            ),
          },
        ]}
      />
    </>
  );
}

export default function CustomerPage(props: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CustomerRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
