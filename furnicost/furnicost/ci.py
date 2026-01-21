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


def ensure_customer_group():
    if frappe.db.exists("Customer Group", "All Customer Groups"):
        return

    doc = frappe.get_doc(
        {
            "doctype": "Customer Group",
            "name": "All Customer Groups",
            "customer_group_name": "All Customer Groups",
            "is_group": 1,
        }
    )
    doc.insert(ignore_permissions=True)
