import frappe


def execute():
    # Preserve the site's custom layout; only change its image-column conditions.
    name = "Báo Giá Print"
    if not frappe.db.exists("Print Format", name):
        return
    doc = frappe.get_doc("Print Format", name)
    if doc.doc_type != "BOQ" or not doc.html:
        return
    original = "{% if flags.has_image %}"
    replacement = '{% if doc.get("show_illustration") in [None, 1, "1"] %}'
    if original in doc.html:
        doc.html = doc.html.replace(original, replacement)
        doc.save(ignore_permissions=True)
