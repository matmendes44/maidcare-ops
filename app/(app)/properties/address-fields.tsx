import { useI18n } from "@/components/i18n-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  zones,
  type AddressErrors,
  type AddressField,
  type AddressValues,
} from "./options";

// Street, unit, city, state, ZIP and zone inputs. Used by the property form
// and, with a name prefix, for the first property on the new-customer form.
export function AddressFields({
  prefix = "",
  initialValues,
  errors = {},
  required = true,
  zone = true,
}: {
  prefix?: string;
  initialValues?: Partial<AddressValues>;
  errors?: AddressErrors;
  required?: boolean;
  // the new-lead form leaves the zone for later
  zone?: boolean;
}) {
  const { t } = useI18n();
  const field = (name: AddressField) => {
    const id = prefix + name;
    return {
      id,
      name: id,
      defaultValue: initialValues?.[name] ?? (name === "state" ? "MD" : ""),
      "aria-invalid": errors[name] ? true : undefined,
      "aria-describedby": errors[name] ? `${id}-error` : undefined,
    };
  };
  const label = (name: AddressField, isRequired = false) => (
    <Label htmlFor={prefix + name}>
      {t.properties.address[name]}
      {required && isRequired && <span aria-hidden="true">*</span>}
    </Label>
  );
  const error = (name: AddressField) =>
    errors[name] && (
      <p id={`${prefix + name}-error`} className="text-[0.8rem] text-destructive">
        {errors[name]}
      </p>
    );

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="grid content-start gap-1.5 sm:col-span-4">
        {label("street", true)}
        <Input {...field("street")} autoComplete="off" />
        {error("street")}
      </div>
      <div className="grid content-start gap-1.5 sm:col-span-2">
        {label("unit")}
        <Input {...field("unit")} autoComplete="off" />
        {error("unit")}
      </div>
      <div className="grid content-start gap-1.5 sm:col-span-3">
        {label("city", true)}
        <Input {...field("city")} autoComplete="off" />
        {error("city")}
      </div>
      <div className="grid content-start gap-1.5 sm:col-span-1">
        {label("state", true)}
        <Input {...field("state")} maxLength={2} autoComplete="off" className="uppercase" />
        {error("state")}
      </div>
      <div className="grid content-start gap-1.5 sm:col-span-2">
        {label("zip", true)}
        <Input {...field("zip")} inputMode="numeric" maxLength={5} autoComplete="off" />
        {error("zip")}
      </div>
      {zone && (
        <div className="grid content-start gap-1.5 sm:col-span-3">
          {label("zone")}
          <NativeSelect {...field("zone")} className="w-full">
            <NativeSelectOption value="">{t.properties.address.zoneNotSet}</NativeSelectOption>
            {zones.map((z) => (
              <NativeSelectOption key={z} value={z}>{t.enums.zone[z]}</NativeSelectOption>
            ))}
          </NativeSelect>
          {error("zone")}
        </div>
      )}
    </div>
  );
}
