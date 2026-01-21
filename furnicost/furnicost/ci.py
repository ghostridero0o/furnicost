import frappe


def ensure_warehouse_type():
    if frappe.db.exists("Warehouse Type", "Transit"):
        return

    doc = frappe.get_doc(
        {
            "doctype": "Warehouse Type",
            "name": "Transit",
            "warehouse_type_name": "Transit",
        }
    )
    doc.insert(ignore_permissions=True)
