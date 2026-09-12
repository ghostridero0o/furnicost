import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class CommissionTier(Document):
	def validate(self):
		self.tier_name = (self.tier_name or "").strip()
		if not self.tier_name:
			frappe.throw(_("Tier Name is required."))

		if self.match_by_contract_value:
			if flt(self.minimum_contract_value) < 0 or flt(self.maximum_contract_value) < 0:
				frappe.throw(_("Contract value limits cannot be negative."))
			if self.maximum_contract_value and flt(self.minimum_contract_value) > flt(self.maximum_contract_value):
				frappe.throw(_("Minimum Contract Value cannot exceed Maximum Contract Value."))

		if self.match_by_project_type and not self.project_types:
			frappe.throw(_("Add at least one Project Type when Match by Project Type is enabled."))

		if not self.match_by_contract_value and not self.match_by_project_type and not self.manual_selection:
			frappe.throw(_("Enable at least one matching method or Manual Selection."))

		project_types = [row.project_type for row in self.project_types]
		if len(project_types) != len(set(project_types)):
			frappe.throw(_("Project Types cannot be duplicated."))

		duplicate = frappe.db.exists("Commission Tier", {"company": self.company, "tier_name": self.tier_name})
		if duplicate and duplicate != self.name:
			frappe.throw(_("Commission Tier {0} already exists for Company {1}.").format(
				frappe.bold(self.tier_name), frappe.bold(self.company)
			))
