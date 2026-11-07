"""Ship FurniCost navigation on both sidebar generations of Frappe."""

import json
from pathlib import Path

import frappe


def sync_sidebar():
    if frappe.db.exists("DocType", "Sidebar"):
        frappe.reload_doc("furnicost", "sidebar", "furnicost", force=True)
    else:
        # Older v16 sites read Workspace Sidebar instead of Sidebar.
        path = Path(frappe.get_app_path("furnicost", "furnicost", "sidebar", "furnicost", "furnicost.json"))
        data = json.loads(path.read_text())
        data["doctype"] = "Workspace Sidebar"
        data["standard"] = 0
        data.pop("modified", None)
        name = data.pop("name")
        if frappe.db.exists("Workspace Sidebar", name):
            doc = frappe.get_doc("Workspace Sidebar", name)
            doc.update(data)
            doc.save(ignore_permissions=True)
        else:
            frappe.get_doc(dict(data, name=name)).insert(ignore_permissions=True)
    frappe.clear_cache()
