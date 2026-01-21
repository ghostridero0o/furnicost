from frappe.model.document import Document
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
