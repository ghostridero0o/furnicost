import frappe


def execute():
	"""Move the legacy Qty multiplier into Unit without changing item amounts."""
	if not frappe.db.has_column("Costing Items", "unit"):
		return

	frappe.db.sql(
		"""
		UPDATE `tabCosting Items`
		SET `unit` = COALESCE(`qty`, 0)
		WHERE COALESCE(`unit`, 0) = 0
		"""
	)
	frappe.db.sql(
		"""
		UPDATE `tabCosting Items`
		SET `qty` = COALESCE(`unit`, 0) * COALESCE(`qty_per_unit`, 0)
		"""
	)
	frappe.db.sql(
		"""
		UPDATE `tabCosting Items`
		SET `amount` = COALESCE(`qty`, 0) * COALESCE(`rate`, 0)
		"""
	)
