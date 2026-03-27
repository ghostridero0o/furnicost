import frappe
from frappe.model.document import Document
from frappe.model.mapper import get_mapped_doc
from frappe.utils import flt


class BOQ(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		total_qty = 0
		total = 0

		for row in self.get("items") or []:
			total_qty += flt(row.qty)
			total += flt(row.amount)

		self.total_qty = total_qty
		self.total = total

		total_taxes_and_charges = 0
		running_total = total
		prev_row_amount = 0

		for tax in self.get("taxes") or []:
			tax_amount = flt(tax.tax_amount)
			charge_type = tax.charge_type or ""
			rate = flt(tax.rate)

			if charge_type == "On Net Total":
				tax_amount = (total * rate) / 100
			elif charge_type == "On Previous Row Amount":
				tax_amount = (prev_row_amount * rate) / 100
			elif charge_type == "On Previous Row Total":
				tax_amount = (running_total * rate) / 100
			elif charge_type == "On Item Quantity":
				tax_amount = total_qty * rate

			if (tax.get("add_deduct_tax") or "") == "Deduct":
				tax_amount = -abs(tax_amount)

			total_taxes_and_charges += tax_amount
			running_total = total + total_taxes_and_charges
			prev_row_amount = tax_amount

			tax.tax_amount = tax_amount
			tax.total = running_total

		self.total_taxes_and_charges = total_taxes_and_charges
		conversion_rate = flt(self.get("conversion_rate")) or 1
		self.base_total_taxes_and_charges = total_taxes_and_charges * conversion_rate

		discount_amount = flt(self.get("discount_amount"))
		discount_percent = flt(self.get("additional_discount_percentage"))
		apply_discount_on = self.get("apply_discount_on") or "Net Total"
		discount_base = total + total_taxes_and_charges if apply_discount_on == "Grand Total" else total

		if discount_percent:
			discount_amount = (discount_base * discount_percent) / 100
			self.discount_amount = discount_amount

		grand_total = total + total_taxes_and_charges
		if apply_discount_on == "Grand Total":
			grand_total -= discount_amount
		else:
			grand_total = total - discount_amount + total_taxes_and_charges

		self.grand_total = grand_total


@frappe.whitelist()
def make_sales_order(source_name, target_doc=None):
	return get_mapped_doc(
		"BOQ",
		source_name,
		{
			"BOQ": {
				"doctype": "Sales Order",
				"field_map": {
					"customer": "customer",
					"customer_name": "customer_name",
					"company": "company",
					"transaction_date": "transaction_date",
					"valid_till": "valid_till",
					"order_type": "order_type",
					"currency": "currency",
					"conversion_rate": "conversion_rate",
					"selling_price_list": "selling_price_list",
					"price_list_currency": "price_list_currency",
					"plc_conversion_rate": "plc_conversion_rate",
					"tax_category": "tax_category",
					"shipping_rule": "shipping_rule",
					"remarks": "remarks",
				},
			},
			"BOQ Item": {
				"doctype": "Sales Order Item",
				"field_map": {
					"uom": "uom",
					"weight_rc": "qty",
					"rate": "rate",
				},
				"postprocess": _set_sales_order_item_custom_name,
			},
		},
		target_doc,
	)


def _set_sales_order_item_custom_name(source, target, source_parent=None):
	item_name = source.get("item_name") or ""
	material_description = source.get("material_description") or ""
	if material_description:
		target.custom_item_custom_name = f"{item_name}\n{material_description}".strip()
	else:
		target.custom_item_custom_name = item_name


@frappe.whitelist()
def get_boq_items(
	customer=None,
	project=None,
	item_name=None,
	material_description=None,
	this_boq=None,
	boq_name=None,
):
	this_boq = frappe.utils.cint(this_boq)
	filters = [
		["BOQ Item", "parenttype", "=", "BOQ"],
		["BOQ Item", "parentfield", "=", "items"],
	]

	if this_boq:
		if not boq_name:
			return []
		filters.append(["BOQ Item", "parent", "=", boq_name])
	else:
		parent_filters = {"docstatus": 1}
		if customer:
			parent_filters["customer"] = customer
		if project:
			parent_filters["project"] = project

		parents = frappe.get_all(
			"BOQ",
			filters=parent_filters,
			pluck="name",
			ignore_permissions=True,
		)
		if not parents:
			return []

		filters.append(["BOQ Item", "parent", "in", parents])

	if item_name:
		filters.append(["BOQ Item", "item_name", "like", f"%{item_name}%"])
	if material_description:
		filters.append(
			[
				"BOQ Item",
				"material_description",
				"like",
				f"%{material_description}%",
			]
		)

	return frappe.get_all(
		"BOQ Item",
		filters=filters,
		fields=[
			"name",
			"item_name",
			"material_description",
			"origin",
			"length",
			"height",
			"depth",
			"qty",
			"uom",
			"weight_rc",
			"rate",
			"amount",
			"image",
			"notes",
			"costing_item",
		],
		order_by="parent, idx",
		limit_page_length=500,
		ignore_permissions=True,
	)
