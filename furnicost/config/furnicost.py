# furnicost/config/furnicost.py

from frappe import _

def get_data():
    return [
        {
            "label": _("FurniCost"),
            "icon": "octicon octicon-cube",
            "items": [
                {
                    "type": "doctype",  # Loại là DocType
                    "name": "Furniture Summary",  # DocType sẽ hiển thị
                    "label": _("Furniture Summary"),
                    "description": _("Manage Furniture Summary"),
                    "onboard": 1  # Hiển thị trong danh sách dropdown khi chọn module
                },
                {
                    "type": "doctype",  # Loại là DocType
                    "name": "Furniture Costing",  # DocType tiếp theo
                    "label": _("Furniture Costing"),
                    "description": _("Manage Furniture Costing records"),
                    "onboard": 0  # Không hiển thị trong dropdown nhưng hiển thị sau khi click vào module
                }
            ]
        }
    ]
