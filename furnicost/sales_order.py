"""Keep BOQ-agreed rates on the Sales Order rows created from BOQ."""
from frappe.utils import flt


def ensure_boq_rate_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"Sales Order Item": [
		{"fieldname": "custom_boq_source", "label": "Source BOQ", "fieldtype": "Link",
		 "options": "BOQ", "insert_after": "rate", "read_only": 1, "module": "FurniCost",
		 "depends_on": "eval:!!doc.custom_boq_source"},
		{"fieldname": "custom_boq_rate", "label": "BOQ Agreed Rate", "fieldtype": "Currency",
		 "options": "currency", "insert_after": "custom_boq_source",
		 "read_only": 1, "module": "FurniCost", "depends_on": "eval:!!doc.custom_boq_source"},
		{"fieldname": "custom_boq_item", "label": "Source BOQ Item", "fieldtype": "Data",
		 "insert_after": "custom_boq_rate", "read_only": 1, "hidden": 1, "module": "FurniCost"},
		{"fieldname": "custom_boq_uom", "label": "BOQ Agreed UOM", "fieldtype": "Link",
		 "options": "UOM", "insert_after": "custom_boq_item", "read_only": 1,
		 "hidden": 1, "module": "FurniCost"},
	]})


def restore_boq_rates(doc):
	for row in doc.get("items") or []:
		if not row.get("custom_boq_source"):
			continue
		if row.get("custom_boq_uom"):
			if row.uom != row.custom_boq_uom and row.item_code:
				from erpnext.stock.get_item_details import get_conversion_factor

				row.conversion_factor = get_conversion_factor(row.item_code, row.custom_boq_uom)["conversion_factor"]
			row.uom = row.custom_boq_uom
			row.stock_qty = flt(row.qty) * flt(row.conversion_factor)
		rate = flt(row.custom_boq_rate)
		row.rate = rate
		row.price_list_rate = rate * (flt(doc.get("conversion_rate")) or 1) / (flt(doc.get("plc_conversion_rate")) or 1)
		row.discount_percentage = 0
		row.discount_amount = 0
		row.margin_type = ""
		row.margin_rate_or_amount = 0
		row.rate_with_margin = rate


class BOQSalesOrderMixin:
	def fetch_item_details(self, item):
		# Core clears UOM when selecting a new Item. Supply the agreed UOM before
		# fetching details so conversion_factor is calculated for the new Item.
		if item.get("custom_boq_source") and item.get("custom_boq_uom"):
			item.uom = item.custom_boq_uom
			item.conversion_factor = None
		return super().fetch_item_details(item)

	def calculate_taxes_and_totals(self):
		restore_boq_rates(self)
		return super().calculate_taxes_and_totals()
