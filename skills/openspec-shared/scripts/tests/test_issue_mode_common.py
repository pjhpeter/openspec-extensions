from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from issue_mode_common import extract_open_work_items  # noqa: E402


class ExtractOpenWorkItemsTest(unittest.TestCase):
    def test_ignores_placeholder_list_items(self) -> None:
        items = extract_open_work_items([
            "- None.",
            "- 无",
            "- 暂无",
            "- n/a",
        ])

        self.assertEqual(items, [])

    def test_keeps_real_list_items(self) -> None:
        items = extract_open_work_items([
            "- 补齐 ISSUE-002 命令覆盖矩阵",
            "- add preload transport follow-up change",
        ])

        self.assertEqual(items, [
            "补齐 ISSUE-002 命令覆盖矩阵",
            "add preload transport follow-up change",
        ])

    def test_ignores_unchecked_placeholder_checkboxes_only(self) -> None:
        items = extract_open_work_items([
            "- [ ] None",
            "- [ ] 无待处理项",
            "- [ ] 真正待办事项",
            "- [x] 已完成事项",
        ])

        self.assertEqual(items, ["真正待办事项"])


if __name__ == "__main__":
    unittest.main()
