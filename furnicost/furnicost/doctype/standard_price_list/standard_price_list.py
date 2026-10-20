import frappe
from frappe import _
from frappe.model.document import Document


class StandardPriceList(Document):
	def validate(self):
		codes = set()
		for row in self.items:
			if row.item_code in codes:
				frappe.throw(_("Duplicate Item Code at row {0}: {1}").format(row.idx, row.item_code))
			codes.add(row.item_code)


@frappe.whitelist()
def preview_excel(content, filename, name=None):
	"""Parse an upload without saving the parent or any child rows."""
	import base64
	from furnicost.furnicost.doctype.standard_price_list.excel_import import parse_workbook

	if name:
		frappe.get_doc("Standard Price List", name).check_permission("write")
	else:
		frappe.has_permission("Standard Price List", "create", throw=True)
	if not filename.lower().endswith(".xlsx"):
		frappe.throw(_("Please select an .xlsx file."))
	if len(content) > 7 * 1024 * 1024:
		frappe.throw(_("The file must be smaller than 5 MB."))
	try:
		result = parse_workbook(base64.b64decode(content, validate=True))
	except (ValueError, OSError) as error:
		frappe.throw(str(error))
	units = {row["uom"] for row in result["items"] if row["uom"]}
	known = set(frappe.get_all("UOM", filters={"name": ["in", list(units)]}, pluck="name")) if units else set()
	valid = []
	for row in result["items"]:
		if row["uom"] and row["uom"] not in known:
			result["warnings"].append(f'{row["item_code"]}: đơn vị chưa tồn tại: {row["uom"]}')
		else:
			valid.append(row)
	result["items"] = valid
	return result


@frappe.whitelist()
def download_excel(items, name=None):
	"""Export the form's current rows, including unsaved edits, without persisting them."""
	import base64
	from furnicost.furnicost.doctype.standard_price_list.excel_import import export_workbook

	if name:
		frappe.get_doc("Standard Price List", name).check_permission("read")
	else:
		frappe.has_permission("Standard Price List", "create", throw=True)
	rows = frappe.parse_json(items)
	if not isinstance(rows, list) or len(rows) > 10000 or any(not isinstance(row, dict) for row in rows):
		frappe.throw(_("Please export a table with at most 10,000 rows."))
	return base64.b64encode(export_workbook(rows)).decode("ascii")
