import frappe


def execute():
	frappe.db.sql("""
		update `tabProject Commission` pc
		set pc.total_incentive = coalesce((
			select sum(p.commission_amount)
			from `tabProject Commission Participant` p
			where p.parent = pc.name
				and p.parenttype = 'Project Commission'
				and p.recipient_type = 'Employee'
		), 0)
	""")
