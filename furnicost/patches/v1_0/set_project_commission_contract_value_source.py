import frappe


def execute():
	frappe.db.sql("""
		update `tabProject Commission`
		set contract_value_source = 'Sales Order'
		where coalesce(contract_value_source, '') = ''
	""")
