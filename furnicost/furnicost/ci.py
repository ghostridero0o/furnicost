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


def ensure_frappe_fixtures():
    from frappe.desk.page.setup_wizard import install_fixtures as frappe_fixtures

    frappe_fixtures.install()


def ensure_erpnext_fixtures():
    from erpnext.setup.setup_wizard.operations import install_fixtures as erpnext_fixtures

    erpnext_fixtures.install(country="India")
