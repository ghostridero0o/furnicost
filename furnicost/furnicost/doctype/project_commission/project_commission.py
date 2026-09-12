import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate, nowdate


class ProjectCommission(Document):
	def before_validate(self):
		if not self.contract_value_source:
			self.contract_value_source = "Sales Order"
		self._set_project_details()
		self._set_contract_document_details()
		self._calculate_amounts()

	def validate(self):
		self._validate_configuration()
		self._validate_participants()

	def before_submit(self):
		self.status = "Approved"

	def before_cancel(self):
		self.status = "Cancelled"

	@frappe.whitelist()
	def apply_policy(self):
		self._set_project_details()
		if not self.policy:
			self.policy = self._get_default_policy()
		if not self.policy:
			frappe.throw(_("No default Commission Policy was found for Company {0} and date {1}.").format(
				frappe.bold(self.company), frappe.bold(self.posting_date)
			))

		policy = frappe.get_doc("Commission Policy", self.policy)
		self.commission_basis = policy.commission_basis
		self._set_contract_document_details(force_contract_value=True)
		if self.commission_basis.startswith("Contract Value"):
			self.commission_base_amount = self.contract_value
		if not self.commission_tier:
			self.commission_tier = self._find_matching_tier()
		if not self.commission_tier:
			frappe.throw(_("No Commission Tier matches this Project Type and Contract Value. Select a manual tier if applicable."))

		tier = frappe.get_doc("Commission Tier", self.commission_tier)
		self.target_gross_margin = tier.target_gross_margin
		if not self._populate_participants(policy):
			frappe.throw(_("Commission Tier {0} has no enabled rules in Policy {1}.").format(
				frappe.bold(self.commission_tier), frappe.bold(self.policy)
			))
		self._calculate_amounts()
		return self

	@frappe.whitelist()
	def load_policy_participants(self):
		if not self.policy or not self.commission_tier:
			self.set("participants", [])
			self._calculate_amounts()
			return self
		policy = frappe.get_doc("Commission Policy", self.policy)
		self.commission_basis = policy.commission_basis
		self._set_contract_document_details(force_contract_value=True)
		if self.commission_basis.startswith("Contract Value"):
			self.commission_base_amount = self.contract_value
		self.target_gross_margin = frappe.db.get_value(
			"Commission Tier", self.commission_tier, "target_gross_margin"
		)
		if not self._populate_participants(policy):
			frappe.throw(_("Commission Tier {0} has no enabled rules in Policy {1}.").format(
				frappe.bold(self.commission_tier), frappe.bold(self.policy)
			))
		self._calculate_amounts()
		return self

	def _populate_participants(self, policy):
		self.set("participants", [])
		count = 0
		for rule in policy.rules:
			if not rule.enabled or rule.commission_tier != self.commission_tier:
				continue
			role = frappe.get_cached_doc("Commission Role", rule.commission_role)
			self.append("participants", {
				"commission_role": rule.commission_role,
				"recipient_type": role.default_party_type,
				"policy_rate": rule.rate,
				"applied_rate": rule.rate,
				"base_amount": self.commission_base_amount,
				"commission_amount": 0,
				"minimum_commission_amount": rule.minimum_commission_amount,
				"maximum_commission_amount": rule.maximum_commission_amount,
				"notes": rule.notes,
			})
			count += 1
		return count

	@frappe.whitelist()
	def match_commission_tier(self):
		self._set_project_details()
		return self._match_commission_tier()

	@frappe.whitelist()
	def set_project_context(self):
		self._set_project_details()
		if not self.policy:
			self.policy = self._get_default_policy()
		if self.policy:
			self.commission_basis = frappe.db.get_value(
				"Commission Policy", self.policy, "commission_basis"
			)
		self._populate_contract_documents()
		self._set_contract_document_details(force_contract_value=True)
		self._match_commission_tier()
		return self

	@frappe.whitelist()
	def set_contract_value_source_context(self):
		self._populate_contract_documents()
		self._set_contract_document_details(force_contract_value=True)
		self._match_commission_tier()
		return self

	@frappe.whitelist()
	def set_contract_documents_context(self):
		self._set_contract_document_details(force_contract_value=True)
		self._match_commission_tier()
		return self

	def _match_commission_tier(self):
		if not self.company:
			return {"commission_tier": None, "reason": "missing_context"}
		if not self.contract_value:
			self.commission_tier = None
			self.target_gross_margin = None
			self.set("participants", [])
			self._calculate_amounts()
			return {"commission_tier": None, "reason": "missing_context"}

		matched_tier = self._find_matching_tier()
		previous_tier = self.commission_tier
		self.commission_tier = matched_tier

		if matched_tier:
			self.target_gross_margin = frappe.db.get_value(
				"Commission Tier", matched_tier, "target_gross_margin"
			)
		else:
			self.target_gross_margin = None

		if previous_tier and previous_tier != matched_tier:
			self.set("participants", [])

		if not self.policy:
			self.policy = self._get_default_policy()
		if not self.policy:
			self._calculate_amounts()
			return {
				"commission_tier": matched_tier,
				"reason": "no_default_policy" if matched_tier else "no_matching_tier",
			}

		policy = frappe.get_doc("Commission Policy", self.policy)
		self.commission_basis = policy.commission_basis
		if self.commission_basis.startswith("Contract Value"):
			self.commission_base_amount = self.contract_value
		missing_policy_rules = False
		if matched_tier and not self.participants:
			missing_policy_rules = not self._populate_participants(policy)
		self._calculate_amounts()

		return {
			"commission_tier": matched_tier,
			"reason": (
				"tier_not_in_policy"
				if missing_policy_rules
				else (None if matched_tier else "no_matching_tier")
			),
		}

	def _set_project_details(self):
		if not self.posting_date:
			self.posting_date = nowdate()
		if not self.project:
			return
		project = frappe.db.get_value(
			"Project", self.project,
			["company", "project_name", "project_type", "customer"],
			as_dict=True,
		)
		if project:
			self.project_name = project.project_name
			self.project_type = project.project_type
			self.customer = project.customer
			self.customer_name = (
				frappe.db.get_value("Customer", project.customer, "customer_name")
				if project.customer else None
			)
			if not self.company:
				self.company = project.company

	def _populate_sales_orders(self):
		self.set("sales_orders", [])
		if not self.project:
			return
		for sales_order in frappe.get_all(
			"Sales Order",
			filters={
				"project": self.project,
				"company": self.company,
				"docstatus": 1,
			},
			fields=[
				"name as sales_order", "transaction_date", "customer",
				"base_net_total", "base_grand_total",
			],
			order_by="transaction_date asc, creation asc",
		):
			self.append("sales_orders", sales_order)

	def _populate_sales_invoices(self):
		self.set("sales_invoices", [])
		if not self.project:
			return
		for sales_invoice in frappe.get_all(
			"Sales Invoice",
			filters={
				"project": self.project,
				"company": self.company,
				"docstatus": 1,
			},
			fields=[
				"name as sales_invoice", "posting_date", "customer",
				"base_net_total", "base_grand_total",
			],
			order_by="posting_date asc, creation asc",
		):
			self.append("sales_invoices", sales_invoice)

	def _populate_contract_documents(self):
		if self.contract_value_source == "Sales Invoice":
			self._populate_sales_invoices()
		else:
			self.contract_value_source = "Sales Order"
			self._populate_sales_orders()

	def _set_contract_document_details(self, force_contract_value=False):
		if self.contract_value_source == "Sales Invoice":
			self._set_sales_invoice_details(force_contract_value=force_contract_value)
		else:
			self._set_sales_order_details(force_contract_value=force_contract_value)

	def _set_sales_order_details(self, force_contract_value=False):
		company_currency = (
			frappe.db.get_value("Company", self.company, "default_currency")
			if self.company else None
		)
		total_contract_value = 0
		valid_sales_orders = 0
		for row in self.sales_orders:
			if not row.sales_order:
				continue
			sales_order = frappe.db.get_value(
				"Sales Order", row.sales_order,
				[
					"project", "company", "customer", "customer_name", "transaction_date",
					"base_net_total", "base_grand_total",
				],
				as_dict=True,
			)
			if not sales_order:
				continue
			row.transaction_date = sales_order.transaction_date
			row.customer = sales_order.customer
			row.base_net_total = sales_order.base_net_total
			row.base_grand_total = sales_order.base_grand_total
			row.company_currency = company_currency
			if not self.customer:
				self.customer = sales_order.customer
			if not self.customer_name and sales_order.customer_name:
				self.customer_name = sales_order.customer_name
			total_contract_value += flt(
				sales_order.base_grand_total
				if self.commission_basis == "Contract Value (After Tax)"
				else sales_order.base_net_total
			)
			valid_sales_orders += 1

		if valid_sales_orders or force_contract_value:
			self.contract_value = total_contract_value
			if self.commission_basis and self.commission_basis.startswith("Contract Value"):
				self.commission_base_amount = self.contract_value

	def _set_sales_invoice_details(self, force_contract_value=False):
		company_currency = (
			frappe.db.get_value("Company", self.company, "default_currency")
			if self.company else None
		)
		total_contract_value = 0
		valid_sales_invoices = 0
		for row in self.sales_invoices:
			if not row.sales_invoice:
				continue
			sales_invoice = frappe.db.get_value(
				"Sales Invoice", row.sales_invoice,
				[
					"project", "company", "customer", "customer_name", "posting_date",
					"base_net_total", "base_grand_total",
				],
				as_dict=True,
			)
			if not sales_invoice:
				continue
			row.posting_date = sales_invoice.posting_date
			row.customer = sales_invoice.customer
			row.base_net_total = sales_invoice.base_net_total
			row.base_grand_total = sales_invoice.base_grand_total
			row.company_currency = company_currency
			if not self.customer:
				self.customer = sales_invoice.customer
			if not self.customer_name and sales_invoice.customer_name:
				self.customer_name = sales_invoice.customer_name
			total_contract_value += flt(
				sales_invoice.base_grand_total
				if self.commission_basis == "Contract Value (After Tax)"
				else sales_invoice.base_net_total
			)
			valid_sales_invoices += 1

		if valid_sales_invoices or force_contract_value:
			self.contract_value = total_contract_value
			if self.commission_basis and self.commission_basis.startswith("Contract Value"):
				self.commission_base_amount = self.contract_value

	def _get_default_policy(self):
		result = frappe.db.sql("""
			select name
			from `tabCommission Policy`
			where company = %(company)s
				and enabled = 1
				and is_default = 1
				and valid_from <= %(posting_date)s
				and (valid_to is null or valid_to = '' or valid_to >= %(posting_date)s)
			order by valid_from desc
			limit 1
		""", {"company": self.company, "posting_date": self.posting_date}, as_dict=False)
		return result[0][0] if result else None

	def _find_matching_tier(self):
		tier_names = frappe.get_all(
			"Commission Tier",
			filters={"company": self.company, "enabled": 1},
			pluck="name",
		)
		tiers = [frappe.get_doc("Commission Tier", name) for name in tier_names]
		tiers.sort(key=lambda tier: (cint(tier.priority), tier.name))

		for tier in tiers:
			if not tier.enabled or tier.company != self.company:
				continue
			project_type_match = bool(
				tier.match_by_project_type
				and self.project_type
				and self.project_type in {row.project_type for row in tier.project_types}
			)
			value_match = tier.match_by_contract_value and self._value_matches_tier(tier)
			if project_type_match or value_match:
				return tier.name
		return None

	def _value_matches_tier(self, tier):
		value = flt(self.contract_value)
		minimum = flt(tier.minimum_contract_value)
		maximum = flt(tier.maximum_contract_value)
		minimum_matches = value >= minimum if tier.minimum_inclusive else value > minimum
		maximum_matches = True if not maximum else (value <= maximum if tier.maximum_inclusive else value < maximum)
		return minimum_matches and maximum_matches

	def _validate_configuration(self):
		if not self.project or not self.company:
			return

		project_company = frappe.db.get_value("Project", self.project, "company")
		if project_company != self.company:
			frappe.throw(_("Project {0} does not belong to Company {1}.").format(
				frappe.bold(self.project), frappe.bold(self.company)
			))

		self._validate_contract_documents()

		if not self.policy or not self.commission_tier:
			return

		policy = frappe.get_doc("Commission Policy", self.policy)
		if policy.company != self.company:
			frappe.throw(_("Commission Policy does not belong to Company {0}.").format(frappe.bold(self.company)))
		if not policy.enabled:
			frappe.throw(_("Commission Policy {0} is disabled.").format(frappe.bold(self.policy)))
		if getdate(self.posting_date) < getdate(policy.valid_from) or (
			policy.valid_to and getdate(self.posting_date) > getdate(policy.valid_to)
		):
			frappe.throw(_("Posting Date is outside the selected policy's effective period."))

		tier = frappe.get_doc("Commission Tier", self.commission_tier)
		if tier.company != self.company:
			frappe.throw(_("Commission Tier does not belong to Company {0}.").format(frappe.bold(self.company)))
		if not any(row.enabled and row.commission_tier == self.commission_tier for row in policy.rules):
			frappe.throw(_("Commission Tier {0} is not configured in Policy {1}.").format(
				frappe.bold(self.commission_tier), frappe.bold(self.policy)
			))

	def _validate_contract_documents(self):
		if self.contract_value_source == "Sales Invoice":
			rows = self.sales_invoices
			doctype = "Sales Invoice"
			link_field = "sales_invoice"
		else:
			rows = self.sales_orders
			doctype = "Sales Order"
			link_field = "sales_order"

		seen_documents = set()
		for row in rows:
			document_name = row.get(link_field)
			if not document_name:
				continue
			if document_name in seen_documents:
				frappe.throw(_("Row {0}: {1} {2} is duplicated.").format(
					row.idx, _(doctype), frappe.bold(document_name)
				))
			seen_documents.add(document_name)
			document = frappe.db.get_value(
				doctype, document_name, ["project", "company", "docstatus"], as_dict=True
			)
			if not document or document.docstatus != 1:
				frappe.throw(_("Row {0}: {1} {2} must be submitted.").format(
					row.idx, _(doctype), frappe.bold(document_name)
				))
			if document.project != self.project:
				frappe.throw(_("Row {0}: {1} {2} is not linked to Project {3}.").format(
					row.idx, _(doctype), frappe.bold(document_name), frappe.bold(self.project)
				))
			if document.company != self.company:
				frappe.throw(_("Row {0}: {1} {2} does not belong to Company {3}.").format(
					row.idx, _(doctype), frappe.bold(document_name), frappe.bold(self.company)
				))

	def _validate_participants(self):
		if not self.policy or not self.commission_tier:
			return

		policy = frappe.get_doc("Commission Policy", self.policy)
		rules = {
			row.commission_role: row
			for row in policy.rules
			if row.enabled and row.commission_tier == self.commission_tier
		}
		for row in self.participants:
			rule = rules.get(row.commission_role)
			if not rule:
				frappe.throw(_("Row {0}: Commission Role is not configured for the selected Policy and Tier.").format(row.idx))
			role_company = frappe.db.get_value("Commission Role", row.commission_role, "company")
			if role_company != self.company:
				frappe.throw(_("Row {0}: Commission Role does not belong to Company {1}.").format(
					row.idx, frappe.bold(self.company)
				))
			if flt(row.paid_amount) > flt(row.commission_amount):
				frappe.throw(_("Row {0}: Paid Amount cannot exceed Commission Amount.").format(row.idx))
			if row.rate_overridden:
				if not policy.allow_rate_override:
					frappe.throw(_("Row {0}: the selected Policy does not allow rate overrides.").format(row.idx))
				if not row.override_reason:
					frappe.throw(_("Row {0}: Override Reason is required when Applied Rate differs from Policy Rate.").format(row.idx))

	def _calculate_amounts(self):
		self.total_commission = 0
		self.total_paid = 0
		self.total_incentive = 0
		for row in self.participants:
			row.base_amount = self.commission_base_amount
			row.rate_overridden = cint(flt(row.applied_rate) != flt(row.policy_rate))
			row.commission_amount = (
				self._get_commission_amount(
					row.base_amount, row.applied_rate,
					row.minimum_commission_amount, row.maximum_commission_amount,
				)
				if row.recipient else 0
			)
			row.outstanding_amount = flt(row.commission_amount) - flt(row.paid_amount)
			self.total_commission += flt(row.commission_amount)
			self.total_paid += flt(row.paid_amount)
			if row.recipient_type == "Employee":
				self.total_incentive += flt(row.commission_amount)
		self.total_outstanding = self.total_commission - self.total_paid
		if self.docstatus == 1:
			if self.total_paid <= 0:
				self.status = "Approved"
			elif self.total_outstanding > 0:
				self.status = "Partly Paid"
			else:
				self.status = "Paid"

	@staticmethod
	def _get_commission_amount(base_amount, rate, minimum_amount=0, maximum_amount=0):
		amount = flt(base_amount) * flt(rate) / 100
		if minimum_amount:
			amount = max(amount, flt(minimum_amount))
		if maximum_amount:
			amount = min(amount, flt(maximum_amount))
		return amount


@frappe.whitelist()
def create_employee_incentives(project_commission, participant_allocations):
	source, allocations = _get_creation_context(
		project_commission, participant_allocations, {"Employee"}
	)
	policy = frappe.get_doc("Commission Policy", source.policy)
	salary_component = policy.employee_incentive_salary_component
	if not salary_component:
		frappe.throw(_("Set Employee Incentive Salary Component in Commission Policy {0} first.").format(
			frappe.bold(source.policy)
		))

	expense_account = policy.employee_incentive_expense_account or frappe.db.get_value(
		"Salary Component Account",
		{"parent": salary_component, "company": source.company},
		"account",
	)
	cost_center = _get_cost_center(source, policy.employee_incentive_cost_center)
	incentive_meta = frappe.get_meta("Employee Incentive")
	if (
		(incentive_meta.has_field("expense_account") and not expense_account)
		or (incentive_meta.has_field("cost_center") and not cost_center)
	):
		frappe.throw(_(
			"Configure an Expense Account and Cost Center for Employee Incentive in Policy {0}."
		).format(frappe.bold(source.policy)))

	created = []
	for allocation in allocations:
		participant = allocation["participant"]
		amount = allocation["amount"]
		incentive = frappe.new_doc("Employee Incentive")
		incentive.employee = participant.recipient
		incentive.company = source.company
		incentive.salary_component = salary_component
		incentive.currency = source.currency
		incentive.payroll_date = source.posting_date
		incentive.incentive_amount = amount
		if incentive_meta.has_field("expense_account"):
			incentive.expense_account = expense_account
		if incentive_meta.has_field("cost_center"):
			incentive.cost_center = cost_center
		incentive.insert()
		participant.employee_incentive = incentive.name
		participant.paid_amount = flt(participant.paid_amount) + amount
		participant.outstanding_amount = flt(participant.commission_amount) - flt(participant.paid_amount)
		_append_disbursement(source, participant, incentive.doctype, incentive.name, amount)
		created.append(incentive.name)

	source._calculate_amounts()
	source.save()
	return {"doctype": "Employee Incentive", "created": created}


@frappe.whitelist()
def create_petty_expenses(project_commission, participant_allocations):
	source, allocations = _get_creation_context(
		project_commission,
		participant_allocations,
		{"Customer", "Supplier", "Sales Partner"},
	)
	policy = frappe.get_doc("Commission Policy", source.policy)
	expense_account = policy.petty_expense_account
	cost_center = _get_cost_center(source, policy.petty_expense_cost_center)
	mode_of_payment = policy.petty_expense_mode_of_payment
	payment_account = frappe.db.get_value(
		"Mode of Payment Account",
		{"parent": mode_of_payment, "company": source.company},
		"default_account",
	) if mode_of_payment else None
	if not expense_account or not cost_center or not mode_of_payment or not payment_account:
		frappe.throw(_(
			"Configure Petty Expense Account, Cost Center, and a Mode of Payment with a default account in Policy {0}."
		).format(frappe.bold(source.policy)))

	created = []
	for allocation in allocations:
		participant = allocation["participant"]
		amount = allocation["amount"]
		recipient_name = participant.recipient_name or _get_recipient_name(
			participant.recipient_type, participant.recipient
		)
		expense = frappe.new_doc("Petty Expense")
		expense.expense_account = expense_account
		expense.cost_center = cost_center
		expense.supplier = participant.recipient
		expense.supplier_name = recipient_name
		expense.date = source.posting_date
		expense.mode_of_payment = mode_of_payment
		expense.payment_account = payment_account
		expense.company = source.company
		expense.amount = amount
		expense.description = _(
			"Project commission for {0} ({1}) - Project {2} - Source {3}"
		).format(recipient_name or participant.recipient, participant.recipient_type, source.project, source.name)
		if expense.meta.has_field("custom_project"):
			expense.custom_project = source.project
		expense.insert()
		participant.petty_expense = expense.name
		participant.paid_amount = flt(participant.paid_amount) + amount
		participant.outstanding_amount = flt(participant.commission_amount) - flt(participant.paid_amount)
		_append_disbursement(source, participant, expense.doctype, expense.name, amount)
		created.append(expense.name)

	source._calculate_amounts()
	source.save()
	return {"doctype": "Petty Expense", "created": created}


def _get_creation_context(project_commission, participant_allocations, allowed_types):
	frappe.db.sql(
		"select name from `tabProject Commission` where name = %s for update",
		project_commission,
	)
	source = frappe.get_doc("Project Commission", project_commission)
	source.check_permission("write")
	if source.docstatus != 1:
		frappe.throw(_("Submit Project Commission {0} before creating related documents.").format(
			frappe.bold(source.name)
		))

	requested_allocations = frappe.parse_json(participant_allocations) or []
	if not requested_allocations:
		frappe.throw(_("Select at least one recipient."))
	allocation_by_participant = {}
	for allocation in requested_allocations:
		participant_name = allocation.get("participant_name")
		if not participant_name or participant_name in allocation_by_participant:
			frappe.throw(_("Each selected recipient must appear exactly once."))
		allocation_by_participant[participant_name] = flt(allocation.get("amount"))

	allocations = []
	for row in source.participants:
		if row.name not in allocation_by_participant:
			continue
		if row.recipient_type not in allowed_types:
			frappe.throw(_("Row {0}: Recipient Type {1} is not allowed for this action.").format(
				row.idx, frappe.bold(row.recipient_type)
			))
		if not row.recipient:
			frappe.throw(_("Row {0}: Recipient is required.").format(row.idx))
		if flt(row.commission_amount) <= 0:
			frappe.throw(_("Row {0}: Commission Amount must be greater than zero.").format(row.idx))
		amount = allocation_by_participant[row.name]
		outstanding_amount = flt(row.commission_amount) - flt(row.paid_amount)
		if amount <= 0:
			frappe.throw(_("Row {0}: Amount This Time must be greater than zero.").format(row.idx))
		if amount > outstanding_amount:
			frappe.throw(_("Row {0}: Amount This Time cannot exceed Outstanding Amount {1}.").format(
				row.idx, frappe.format_value(outstanding_amount, {"fieldtype": "Currency", "options": source.currency})
			))
		allocations.append({"participant": row, "amount": amount})

	if len(allocations) != len(allocation_by_participant):
		frappe.throw(_("One or more selected recipients do not belong to this Project Commission."))
	return source, allocations


def _append_disbursement(source, participant, reference_doctype, reference_document, amount):
	source.append("disbursements", {
		"participant": participant.name,
		"commission_role": participant.commission_role,
		"recipient_type": participant.recipient_type,
		"recipient": participant.recipient,
		"reference_doctype": reference_doctype,
		"reference_document": reference_document,
		"amount": amount,
		"posting_date": nowdate(),
	})


def _get_cost_center(source, configured_cost_center=None):
	return (
		configured_cost_center
		or frappe.db.get_value("Project", source.project, "cost_center")
		or frappe.db.get_value("Company", source.company, "cost_center")
	)


def _get_recipient_name(recipient_type, recipient):
	name_fields = {
		"Customer": "customer_name",
		"Employee": "employee_name",
		"Sales Partner": "partner_name",
		"Supplier": "supplier_name",
	}
	return frappe.db.get_value(recipient_type, recipient, name_fields.get(recipient_type, "name"))
