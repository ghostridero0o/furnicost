import frappe
from frappe import _
from frappe.model.document import Document


class CommissionRole(Document):
	def validate(self):
		self.role_name = (self.role_name or "").strip()
		if not self.role_name:
			frappe.throw(_("Role Name is required."))

		filters = {"company": self.company, "role_name": self.role_name}
		duplicate = frappe.db.exists("Commission Role", filters)
		if duplicate and duplicate != self.name:
			frappe.throw(_("Commission Role {0} already exists for Company {1}.").format(
				frappe.bold(self.role_name), frappe.bold(self.company)
			))
