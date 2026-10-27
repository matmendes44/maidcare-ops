import { relations } from "drizzle-orm/relations";
import { customers, contacts, properties, servicePlans, payments, appointments, gpsStops, users, sessions, vehicles, userAvatars, invoices } from "../db/schema";

export const customersRelations = relations(customers, ({one, many}) => ({
	customer: one(customers, {
		fields: [customers.referredById],
		references: [customers.id],
		relationName: "customers_referredById_customers_id"
	}),
	customers: many(customers, {
		relationName: "customers_referredById_customers_id"
	}),
	contacts: many(contacts),
	properties: many(properties, {
		relationName: "customer_properties"
	}),
	billingProperty: one(properties, {
		fields: [customers.billingPropertyId],
		references: [properties.id],
		relationName: "customer_billing_property"
	}),
	payments: many(payments),
	appointments: many(appointments),
	invoices: many(invoices),
}));

export const contactsRelations = relations(contacts, ({one}) => ({
	customer: one(customers, {
		fields: [contacts.customerId],
		references: [customers.id]
	}),
}));

export const propertiesRelations = relations(properties, ({one, many}) => ({
	customer: one(customers, {
		fields: [properties.customerId],
		references: [customers.id],
		relationName: "customer_properties"
	}),
	billedCustomers: many(customers, {
		relationName: "customer_billing_property"
	}),
	servicePlans: many(servicePlans),
	appointments: many(appointments),
	gpsStops: many(gpsStops),
}));

export const servicePlansRelations = relations(servicePlans, ({one, many}) => ({
	property: one(properties, {
		fields: [servicePlans.propertyId],
		references: [properties.id]
	}),
	appointments: many(appointments),
}));

export const paymentsRelations = relations(payments, ({one}) => ({
	customer: one(customers, {
		fields: [payments.customerId],
		references: [customers.id]
	}),
	appointment: one(appointments, {
		fields: [payments.appointmentId],
		references: [appointments.id]
	}),
}));

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	payments: many(payments),
	customer: one(customers, {
		fields: [appointments.customerId],
		references: [customers.id]
	}),
	vehicle: one(vehicles, {
		fields: [appointments.vehicleId],
		references: [vehicles.id]
	}),
	property: one(properties, {
		fields: [appointments.propertyId],
		references: [properties.id]
	}),
	servicePlan: one(servicePlans, {
		fields: [appointments.servicePlanId],
		references: [servicePlans.id]
	}),
	gpsStops: many(gpsStops),
}));

export const gpsStopsRelations = relations(gpsStops, ({one}) => ({
	property: one(properties, {
		fields: [gpsStops.propertyId],
		references: [properties.id]
	}),
	appointment: one(appointments, {
		fields: [gpsStops.appointmentId],
		references: [appointments.id]
	}),
}));
export const usersRelations = relations(users, ({one, many}) => ({
	sessions: many(sessions),
	avatar: one(userAvatars, {
		fields: [users.id],
		references: [userAvatars.userId]
	}),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));


export const vehiclesRelations = relations(vehicles, ({many}) => ({
	appointments: many(appointments),
}));

export const invoicesRelations = relations(invoices, ({one}) => ({
	customer: one(customers, {
		fields: [invoices.customerId],
		references: [customers.id]
	}),
	property: one(properties, {
		fields: [invoices.propertyId],
		references: [properties.id]
	}),
}));
