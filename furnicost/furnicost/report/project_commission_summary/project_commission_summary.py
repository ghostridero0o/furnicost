import frappe
from frappe import _
from frappe.utils import cint, flt, getdate


def execute(filters=None):
	filters = frappe._dict(filters or {})
	_validate_filters(filters)
	parents = _get_parent_rows(filters)
	participants = _get_participants(parents, filters)
	_fill_recipient_names(participants)

	if filters.get("recipient_type") or filters.get("recipient"):
		matching_parents = {row.parent for row in participants}
		parents = [row for row in parents if row.name in matching_parents]

	if cint(filters.get("summary_view")):
		data = _get_summary_data(parents, participants)
		columns = _get_summary_columns()
	else:
		data = _get_detail_data(parents, participants)
		columns = _get_detail_columns(parents)

	return columns, data, None, _get_chart(parents, data, filters), _get_report_summary(parents, data, filters)


def _validate_filters(filters):
	if not filters.get("company"):
		frappe.throw(_("Company is required."))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("From Date and To Date are required."))
	if getdate(filters.from_date) > getdate(filters.to_date):
		frappe.throw(_("From Date cannot be after To Date."))
	if not frappe.has_permission("Project Commission", "read"):
		frappe.throw(_("You do not have permission to view Project Commission."), frappe.PermissionError)


def _normalize_multiselect(value):
	if not value:
		return []
	if isinstance(value, str):
		value = frappe.parse_json(value) if value.startswith("[") else [value]
	return [item for item in value if item]


def _get_parent_rows(filters):
	doc_filters = {
		"company": filters.company,
		"posting_date": ["between", [filters.from_date, filters.to_date]],
	}
	if projects := _normalize_multiselect(filters.get("project")):
		doc_filters["project"] = ["in", projects]
	for fieldname in ("customer", "policy", "commission_tier", "status", "contract_value_source"):
		if filters.get(fieldname):
			doc_filters[fieldname] = filters.get(fieldname)
	if not cint(filters.get("include_cancelled")) and filters.get("status") != "Cancelled":
		doc_filters["docstatus"] = ["<", 2]

	return frappe.get_list(
		"Project Commission",
		filters=doc_filters,
		fields=[
			"name", "posting_date", "status", "project", "project_name", "customer",
			"customer_name", "contract_value_source", "contract_value",
			"commission_base_amount", "total_commission", "total_paid", "total_incentive",
			"total_outstanding", "policy", "commission_tier", "currency", "company",
		],
		order_by="posting_date desc, modified desc",
		limit_page_length=0,
	)


def _get_participants(parents, filters):
	parent_names = [row.name for row in parents]
	if not parent_names:
		return []
	participant_filters = {"parent": ["in", parent_names], "parenttype": "Project Commission"}
	if filters.get("recipient_type"):
		participant_filters["recipient_type"] = filters.recipient_type
	if filters.get("recipient"):
		participant_filters["recipient"] = filters.recipient
	return frappe.get_all(
		"Project Commission Participant",
		filters=participant_filters,
		fields=[
			"parent", "idx", "commission_role", "recipient_type", "recipient",
			"recipient_name", "applied_rate", "base_amount", "commission_amount",
			"paid_amount", "outstanding_amount",
		],
		order_by="parent asc, idx asc",
	)


def _fill_recipient_names(participants):
	name_fields = {
		"Employee": "employee_name",
		"Supplier": "supplier_name",
		"Customer": "customer_name",
		"Sales Partner": "partner_name",
	}
	missing_by_type = {}
	for row in participants:
		if row.recipient and not row.recipient_name and row.recipient_type in name_fields:
			missing_by_type.setdefault(row.recipient_type, set()).add(row.recipient)

	resolved_names = {}
	for recipient_type, recipient_names in missing_by_type.items():
		name_field = name_fields[recipient_type]
		for recipient in frappe.get_all(
			recipient_type,
			filters={"name": ["in", list(recipient_names)]},
			fields=["name", name_field],
		):
			resolved_names[(recipient_type, recipient.name)] = recipient.get(name_field)

	for row in participants:
		if not row.recipient_name:
			row.recipient_name = resolved_names.get((row.recipient_type, row.recipient)) or row.recipient


def _get_summary_data(parents, participants):
	currency = parents[0].currency if parents else None
	grouped = {}
	for row in participants:
		key = (row.recipient_type or "", row.recipient or "")
		total = grouped.setdefault(key, {
			"recipient_type": row.recipient_type,
			"recipient": row.recipient,
			"recipient_name": row.recipient_name or row.recipient or _("Not Set"),
			"total_commission": 0,
			"paid_amount": 0,
			"outstanding_amount": 0,
			"currency": currency,
		})
		total["total_commission"] += flt(row.commission_amount)
		total["paid_amount"] += flt(row.paid_amount)
		total["outstanding_amount"] += flt(row.outstanding_amount)
	return sorted(
		grouped.values(),
		key=lambda row: (row["recipient_type"] or "", row["recipient_name"] or ""),
	)


def _get_detail_data(parents, participants):
	currency = parents[0].currency if parents else None
	column_by_parent = {
		row.name: f"project_commission_{index}"
		for index, row in enumerate(parents, start=1)
	}
	grouped = {}
	for participant in participants:
		column = column_by_parent.get(participant.parent)
		if not column:
			continue
		key = (participant.recipient_type or "", participant.recipient or "")
		row = grouped.setdefault(key, {
			"recipient_type": participant.recipient_type,
			"recipient": participant.recipient,
			"recipient_name": participant.recipient_name or participant.recipient or _("Not Set"),
			"total_commission": 0,
			"paid_amount": 0,
			"outstanding_amount": 0,
			"currency": currency,
		})
		row[column] = flt(row.get(column)) + flt(participant.commission_amount)
		row["total_commission"] += flt(participant.commission_amount)
		row["paid_amount"] += flt(participant.paid_amount)
		row["outstanding_amount"] += flt(participant.outstanding_amount)
	return sorted(
		grouped.values(),
		key=lambda row: (row["recipient_type"] or "", row["recipient_name"] or ""),
	)


def _get_summary_columns():
	return [
		{"label": _("Recipient Type"), "fieldname": "recipient_type", "fieldtype": "Data", "width": 150},
		{"label": _("Recipient"), "fieldname": "recipient_name", "fieldtype": "Data", "width": 220},
		{"label": _("Total Commission"), "fieldname": "total_commission", "fieldtype": "Currency", "options": "currency", "width": 160},
		{"label": _("Paid Amount"), "fieldname": "paid_amount", "fieldtype": "Currency", "options": "currency", "width": 150},
		{"label": _("Outstanding Amount"), "fieldname": "outstanding_amount", "fieldtype": "Currency", "options": "currency", "width": 170},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "hidden": 1},
		{"label": _("Recipient ID"), "fieldname": "recipient", "fieldtype": "Dynamic Link", "options": "recipient_type", "hidden": 1},
	]


def _get_detail_columns(parents):
	columns = [
		{"label": _("Recipient Type"), "fieldname": "recipient_type", "fieldtype": "Data", "width": 115},
		{"label": _("Recipient"), "fieldname": "recipient_name", "fieldtype": "Data", "width": 200},
	]
	columns.extend(
		{
			"label": row.project_name or row.name,
			"fieldname": f"project_commission_{index}",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 150,
		}
		for index, row in enumerate(parents, start=1)
	)
	columns.extend([
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link", "options": "Currency", "hidden": 1},
		{"label": _("Recipient ID"), "fieldname": "recipient", "fieldtype": "Dynamic Link", "options": "recipient_type", "hidden": 1},
		{"label": _("Total Commission"), "fieldname": "total_commission", "fieldtype": "Currency", "options": "currency", "hidden": 1},
		{"label": _("Paid Amount"), "fieldname": "paid_amount", "fieldtype": "Currency", "options": "currency", "hidden": 1},
		{"label": _("Outstanding Amount"), "fieldname": "outstanding_amount", "fieldtype": "Currency", "options": "currency", "hidden": 1},
	])
	return columns


def _get_report_summary(parents, data, filters):
	currency = parents[0].currency if parents else frappe.db.get_value("Company", filters.company, "default_currency")
	total_contract_value = sum(flt(row.contract_value) for row in parents)
	total_commission = sum(flt(row.get("total_commission")) for row in data)
	total_paid = sum(flt(row.get("paid_amount")) for row in data)
	total_incentive = sum(
		flt(row.get("total_commission"))
		for row in data if row.get("recipient_type") == "Employee"
	)
	total_outstanding = sum(flt(row.get("outstanding_amount")) for row in data)

	def card(label, value, indicator):
		return {"label": label, "value": value, "indicator": indicator, "datatype": "Currency", "currency": currency}

	return [
		card(_("Contract Value"), total_contract_value, "Blue"),
		card(_("Total Commission"), total_commission, "Purple"),
		card(_("Employee Incentive"), total_incentive, "Orange"),
		card(_("Paid Amount"), total_paid, "Green"),
		card(_("Outstanding Amount"), total_outstanding, "Red" if total_outstanding > 0 else "Green"),
	]


def _get_chart(parents, data, filters):
	project_totals = {}
	for row in parents:
		key = row.get("project_name") or row.get("project") or row.get("name")
		values = project_totals.setdefault(key, {"paid": 0, "outstanding": 0})
		values["paid"] += flt(row.get("total_paid"))
		values["outstanding"] += flt(row.get("total_outstanding"))

	top_projects = sorted(
		project_totals.items(),
		key=lambda item: abs(item[1]["paid"]) + abs(item[1]["outstanding"]),
		reverse=True,
	)[:10]
	if not top_projects:
		return None
	return {
		"data": {
			"labels": [item[0] for item in top_projects],
			"datasets": [
				{"name": _("Paid Amount"), "values": [item[1]["paid"] for item in top_projects]},
				{"name": _("Outstanding Amount"), "values": [item[1]["outstanding"] for item in top_projects]},
			],
		},
		"type": "bar",
		"colors": ["#28a745", "#ff5858"],
		"barOptions": {"stacked": True},
	}
