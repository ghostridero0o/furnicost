import frappe


def execute():
	if not frappe.db.has_column("Project Commission", "sales_order"):
		return

	project_commissions = frappe.db.sql("""
		select pc.name, pc.sales_order, pc.company
		from `tabProject Commission` pc
		where coalesce(pc.sales_order, '') != ''
			and not exists (
				select 1
				from `tabProject Commission Sales Order` pcso
				where pcso.parent = pc.name
					and pcso.parenttype = 'Project Commission'
			)
	""", as_dict=True)

	for project_commission in project_commissions:
		sales_order = frappe.db.get_value(
			"Sales Order",
			project_commission.sales_order,
			["transaction_date", "customer", "base_net_total", "base_grand_total"],
			as_dict=True,
		)
		if not sales_order:
			continue
		frappe.get_doc({
			"doctype": "Project Commission Sales Order",
			"parent": project_commission.name,
			"parenttype": "Project Commission",
			"parentfield": "sales_orders",
			"idx": 1,
			"sales_order": project_commission.sales_order,
			"transaction_date": sales_order.transaction_date,
			"customer": sales_order.customer,
			"base_net_total": sales_order.base_net_total,
			"base_grand_total": sales_order.base_grand_total,
			"company_currency": frappe.db.get_value(
				"Company", project_commission.company, "default_currency"
			),
		}).db_insert()
