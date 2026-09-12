import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class CommissionPolicy(Document):
	def validate(self):
		self.policy_name = (self.policy_name or "").strip()
		self._validate_dates()
		self._validate_rules()
		self._validate_creation_defaults()
		self._validate_default_period()

	def _validate_dates(self):
		if self.valid_to and getdate(self.valid_from) > getdate(self.valid_to):
			frappe.throw(_("Valid From cannot be after Valid To."))

	def _validate_rules(self):
		seen = set()
		for row in self.rules:
			key = (row.commission_tier, row.commission_role)
			if key in seen:
				frappe.throw(_("Row {0}: the Tier and Role combination is duplicated.").format(row.idx))
			seen.add(key)

			if flt(row.rate) < 0:
				frappe.throw(_("Row {0}: Rate cannot be negative.").format(row.idx))
			if row.maximum_commission_amount and flt(row.minimum_commission_amount) > flt(row.maximum_commission_amount):
				frappe.throw(_("Row {0}: Minimum Commission Amount cannot exceed Maximum Commission Amount.").format(row.idx))

			for doctype, name in (("Commission Tier", row.commission_tier), ("Commission Role", row.commission_role)):
				company = frappe.db.get_value(doctype, name, "company")
				if company != self.company:
					frappe.throw(_("Row {0}: {1} {2} does not belong to Company {3}.").format(
						row.idx, _(doctype), frappe.bold(name), frappe.bold(self.company)
					))

	def _validate_default_period(self):
		if not self.enabled or not self.is_default:
			return

		filters = {"company": self.company, "enabled": 1, "is_default": 1, "name": ["!=", self.name]}
		for policy in frappe.get_all("Commission Policy", filters=filters, fields=["name", "valid_from", "valid_to"]):
			other_start = getdate(policy.valid_from)
			other_end = getdate(policy.valid_to) if policy.valid_to else None
			this_start = getdate(self.valid_from)
			this_end = getdate(self.valid_to) if self.valid_to else None
			if (not other_end or this_start <= other_end) and (not this_end or other_start <= this_end):
				frappe.throw(_("Default policy period overlaps with {0}.").format(frappe.bold(policy.name)))

	def _validate_creation_defaults(self):
		if self.employee_incentive_salary_component:
			component_type = frappe.db.get_value(
				"Salary Component", self.employee_incentive_salary_component, "type"
			)
			if (component_type or "").lower() != "earning":
				frappe.throw(_("Employee Incentive Salary Component must be an Earning component."))

		for fieldname in ("employee_incentive_expense_account", "petty_expense_account"):
			account = self.get(fieldname)
			if account and frappe.db.get_value("Account", account, "company") != self.company:
				frappe.throw(_("{0} does not belong to Company {1}.").format(
					frappe.bold(account), frappe.bold(self.company)
				))

		for fieldname in ("employee_incentive_cost_center", "petty_expense_cost_center"):
			cost_center = self.get(fieldname)
			if cost_center and frappe.db.get_value("Cost Center", cost_center, "company") != self.company:
				frappe.throw(_("{0} does not belong to Company {1}.").format(
					frappe.bold(cost_center), frappe.bold(self.company)
				))
