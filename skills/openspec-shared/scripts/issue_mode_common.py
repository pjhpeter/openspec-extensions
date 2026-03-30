#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

CONFIG_RELATIVE_PATH = Path("openspec") / "issue-mode.json"
CONTROL_DIR_NAME = "control"
ROUND_FILE_PATTERN = "ROUND-*.md"
ISSUE_ID_PATTERN = re.compile(r"\bISSUE-\d+\b", re.IGNORECASE)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$")
NUMBERED_TITLE_RE = re.compile(r"^\s*\d+\.\s+(.+?)\s*$")
BOLD_TITLE_RE = re.compile(r"^\s*\*\*(.+?)\*\*\s*$")
CHECKBOX_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+\[(?P<state>[ xX])\]\s+(?P<text>.+?)\s*$")
LIST_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+(?P<text>.+?)\s*$")
PLACEHOLDER_WORK_ITEM_RE = re.compile(r"[\s`*_~\-.。,，;；:：!?！？()\[\]{}<>/\\]+")
BACKLOG_SECTION_ALIASES = {
    "must_fix_now": (
        "must fix now",
        "must-fix-now",
        "mustfixnow",
        "must fix",
        "必须立即修复",
        "必须修复",
        "立即修复",
    ),
    "should_fix_if_cheap": (
        "should fix if cheap",
        "should-fix-if-cheap",
        "shouldfixifcheap",
        "应该修复",
        "低成本修复",
    ),
    "defer": (
        "defer",
        "deferred",
        "延后",
        "延期",
        "暂缓",
    ),
}
ROUND_SECTION_ALIASES = {
    "round_target": (
        "round target",
        "目标",
        "本轮目标",
        "轮次目标",
    ),
    "target_mode": (
        "target mode",
        "目标模式",
        "模式",
    ),
    "acceptance_criteria": (
        "acceptance criteria",
        "验收标准",
        "验收条件",
    ),
    "non_goals": (
        "non-goals",
        "non goals",
        "非目标",
    ),
    "scope_in_round": (
        "scope in round",
        "round scope",
        "scope",
        "本轮范围",
        "范围",
    ),
    "normalized_backlog": (
        "normalized backlog",
        "backlog",
        "规范化 backlog",
        "待办",
    ),
    "fixes_completed": (
        "fixes or revisions completed",
        "fixes completed",
        "修复完成",
        "修订完成",
    ),
    "re_review_result": (
        "re-review result",
        "re review result",
        "review result",
        "复审结果",
        "复核结果",
    ),
    "acceptance_verdict": (
        "acceptance verdict",
        "verdict",
        "验收结论",
        "验收结果",
        "结论",
    ),
    "next_action": (
        "next action",
        "next step",
        "下一步",
        "后续动作",
        "后续步骤",
    ),
}
ROUND_ACCEPT_KEYWORDS = (
    "accepted",
    "approve",
    "approved",
    "pass",
    "passed",
    "through",
    "通过",
    "已通过",
    "接受",
    "已接受",
    "已验收",
    "可继续",
)
ROUND_REJECT_KEYWORDS = (
    "reject",
    "rejected",
    "fail",
    "failed",
    "blocked",
    "repair",
    "revise",
    "rework",
    "不通过",
    "驳回",
    "阻塞",
    "返工",
    "修复",
)
VERIFY_ACTION_KEYWORDS = (
    "verify",
    "archive",
    "closeout",
    "ready for verify",
    "run verify",
    "归档",
    "验收",
    "验证",
    "收尾",
    "关闭",
)
DEFAULT_CONFIG: dict[str, Any] = {
    "worktree_root": ".worktree",
    "validation_commands": [
        "pnpm lint",
        "pnpm type-check",
    ],
    "worker_worktree": {
        "mode": "detach",
        "base_ref": "HEAD",
        "branch_prefix": "opsx",
    },
    "rra": {
        "gate_mode": "advisory",
    },
    "subagent_team": {
        "auto_advance_after_design_review": False,
        "auto_advance_after_issue_planning_review": False,
        "auto_advance_to_next_issue_after_issue_pass": False,
        "auto_run_change_verify": False,
        "auto_archive_after_verify": False,
    },
}
SUBAGENT_TEAM_AUTOMATION_FIELDS = (
    "auto_advance_after_design_review",
    "auto_advance_after_issue_planning_review",
    "auto_advance_to_next_issue_after_issue_pass",
    "auto_run_change_verify",
    "auto_archive_after_verify",
)


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        current = result.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            result[key] = deep_merge(current, value)
            continue
        result[key] = value
    return result


def normalize_markdown_label(value: str) -> str:
    normalized = re.sub(r"[`*_#]+", "", value).strip()
    normalized = normalized.strip(":：-–—|")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.casefold()


NORMALIZED_BACKLOG_SECTION_ALIASES = {
    key: {normalize_markdown_label(alias) for alias in aliases}
    for key, aliases in BACKLOG_SECTION_ALIASES.items()
}
NORMALIZED_ROUND_SECTION_ALIASES = {
    key: {normalize_markdown_label(alias) for alias in aliases}
    for key, aliases in ROUND_SECTION_ALIASES.items()
}


def line_title_candidate(line: str) -> str | None:
    for pattern in (HEADING_RE, NUMBERED_TITLE_RE, BOLD_TITLE_RE):
        match = pattern.match(line)
        if match:
            return match.group(1).strip()
    return None


def match_markdown_section(
    line: str,
    alias_map: dict[str, set[str]],
) -> tuple[str, str] | None:
    raw_title = line_title_candidate(line)
    if raw_title is None:
        return None

    candidates = [(raw_title, "")]
    for separator in (":", "：", " - ", " – ", " — ", " | "):
        if separator not in raw_title:
            continue
        left, right = raw_title.split(separator, 1)
        candidates.append((left.strip(), right.strip()))

    for title, inline_body in candidates:
        normalized = normalize_markdown_label(title)
        for canonical, aliases in alias_map.items():
            if normalized in aliases:
                return canonical, inline_body
    return None


def extract_markdown_sections(
    text: str,
    alias_map: dict[str, set[str]],
) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current_section: str | None = None

    for raw_line in text.splitlines():
        matched = match_markdown_section(raw_line, alias_map)
        if matched is not None:
            current_section, inline_body = matched
            if current_section not in sections:
                sections[current_section] = []
            if inline_body:
                sections[current_section].append(inline_body)
            continue

        if current_section is not None and HEADING_RE.match(raw_line):
            current_section = None
            continue

        if current_section is not None:
            sections.setdefault(current_section, []).append(raw_line.rstrip())

    return sections


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


EMPTY_WORK_ITEM_SENTINELS = {
    "none",
    "n/a",
    "na",
    "empty",
    "nothing",
    "noopenitems",
    "noopenitem",
    "noblocker",
    "noblockers",
    "无",
    "暂无",
    "没有",
    "无待办",
    "无待处理项",
    "无阻塞",
    "无阻塞项",
}


def is_placeholder_work_item(text: str) -> bool:
    normalized = PLACEHOLDER_WORK_ITEM_RE.sub("", text).casefold()
    return normalized in EMPTY_WORK_ITEM_SENTINELS


def extract_open_work_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("<!--"):
            continue
        checkbox_match = CHECKBOX_ITEM_RE.match(line)
        if checkbox_match:
            if checkbox_match.group("state").strip().casefold() == "x":
                continue
            text = checkbox_match.group("text").strip()
            if is_placeholder_work_item(text):
                continue
            items.append(text)
            continue
        list_match = LIST_ITEM_RE.match(line)
        if list_match:
            text = list_match.group("text").strip()
            if is_placeholder_work_item(text):
                continue
            items.append(text)
    return dedupe_strings(items)


def extract_section_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("<!--"):
            continue
        checkbox_match = CHECKBOX_ITEM_RE.match(line)
        if checkbox_match:
            items.append(checkbox_match.group("text").strip())
            continue
        list_match = LIST_ITEM_RE.match(line)
        if list_match:
            items.append(list_match.group("text").strip())
            continue
        items.append(line)
    return dedupe_strings(items)


def collapse_section_lines(lines: list[str]) -> str:
    parts = [line.strip() for line in lines if line.strip()]
    return " ".join(parts).strip()


def text_contains_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    haystack = text.casefold()
    return any(keyword.casefold() in haystack for keyword in keywords)


def round_acceptance_status(text: str) -> str:
    if not text.strip():
        return "missing"
    if text_contains_keyword(text, ROUND_REJECT_KEYWORDS):
        return "rejected"
    if text_contains_keyword(text, ROUND_ACCEPT_KEYWORDS):
        return "accepted"
    return "unknown"


def round_allows_verify(acceptance_text: str, next_action_text: str) -> bool:
    if round_acceptance_status(acceptance_text) != "accepted":
        return False
    return text_contains_keyword(next_action_text or acceptance_text, VERIFY_ACTION_KEYWORDS)


def extract_issue_ids_from_text(text: str) -> list[str]:
    return dedupe_strings([match.group(0).upper() for match in ISSUE_ID_PATTERN.finditer(text)])


def parse_frontmatter(text: str) -> dict[str, object]:
    lines = text.splitlines()
    if len(lines) < 3 or lines[0].strip() != "---":
        return {}

    result: dict[str, object] = {}
    current_key: str | None = None
    current_list: list[str] | None = None

    for line in lines[1:]:
        stripped = line.rstrip()
        if stripped == "---":
            if current_key is not None and current_list is not None:
                result[current_key] = current_list
            return result

        if stripped.startswith("  - ") or stripped.startswith("- "):
            if current_key is None:
                continue
            if current_list is None:
                current_list = []
            current_list.append(stripped.split("- ", 1)[1].strip())
            continue

        if ":" not in stripped:
            continue

        if current_key is not None and current_list is not None:
            result[current_key] = current_list

        key, value = stripped.split(":", 1)
        current_key = key.strip()
        value = value.strip()
        if value:
            result[current_key] = value
            current_list = None
        else:
            current_list = []

    return {}


def read_issue_frontmatter(repo_root: Path, change: str, issue_id: str) -> dict[str, object]:
    issue_path = repo_root / "openspec" / "changes" / change / "issues" / f"{issue_id}.md"
    if not issue_path.exists():
        return {}
    return parse_frontmatter(issue_path.read_text())


def normalize_string_list(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    items: list[str] = []
    for value in values:
        text = str(value).strip()
        if text and text not in items:
            items.append(text)
    return items


def normalize_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def normalize_subagent_team_flags(raw: object) -> dict[str, bool]:
    values = raw if isinstance(raw, dict) else {}
    defaults = DEFAULT_CONFIG["subagent_team"]
    return {
        "auto_advance_after_design_review": normalize_bool(
            values.get("auto_advance_after_design_review", defaults["auto_advance_after_design_review"]),
            bool(defaults["auto_advance_after_design_review"]),
        ),
        "auto_advance_after_issue_planning_review": normalize_bool(
            values.get("auto_advance_after_issue_planning_review", defaults["auto_advance_after_issue_planning_review"]),
            bool(defaults["auto_advance_after_issue_planning_review"]),
        ),
        "auto_advance_to_next_issue_after_issue_pass": normalize_bool(
            values.get("auto_advance_to_next_issue_after_issue_pass", defaults["auto_advance_to_next_issue_after_issue_pass"]),
            bool(defaults["auto_advance_to_next_issue_after_issue_pass"]),
        ),
        "auto_run_change_verify": normalize_bool(
            values.get("auto_run_change_verify", defaults["auto_run_change_verify"]),
            bool(defaults["auto_run_change_verify"]),
        ),
        "auto_archive_after_verify": normalize_bool(
            values.get("auto_archive_after_verify", defaults["auto_archive_after_verify"]),
            bool(defaults["auto_archive_after_verify"]),
        ),
    }


def automation_profile(config: dict[str, Any]) -> str:
    gate_mode = str(config.get("rra", {}).get("gate_mode", "advisory")).strip() or "advisory"
    subagent_team = config.get("subagent_team", {})
    if all(bool(subagent_team.get(field, False)) for field in SUBAGENT_TEAM_AUTOMATION_FIELDS) and gate_mode == "enforce":
        return "full_auto"
    if not any(bool(subagent_team.get(field, False)) for field in SUBAGENT_TEAM_AUTOMATION_FIELDS) and gate_mode == "advisory":
        return "semi_auto"
    return "custom"


def load_issue_mode_config(repo_root: Path) -> dict[str, Any]:
    config_path = repo_root / CONFIG_RELATIVE_PATH
    config = dict(DEFAULT_CONFIG)

    if config_path.exists():
        payload = json.loads(config_path.read_text())
        if not isinstance(payload, dict):
            raise SystemExit(f"{CONFIG_RELATIVE_PATH} must contain a JSON object.")
        config = deep_merge(DEFAULT_CONFIG, payload)

    worktree_root = str(config.get("worktree_root", DEFAULT_CONFIG["worktree_root"])).strip() or ".worktree"
    if Path(worktree_root).is_absolute():
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worktree_root` must be repo-relative.")

    validation_commands = normalize_string_list(config.get("validation_commands"))
    if not validation_commands:
        validation_commands = list(DEFAULT_CONFIG["validation_commands"])

    worker_worktree = config.get("worker_worktree", {})
    if not isinstance(worker_worktree, dict):
        worker_worktree = {}
    worktree_mode = str(worker_worktree.get("mode", DEFAULT_CONFIG["worker_worktree"]["mode"])).strip() or "detach"
    if worktree_mode not in {"detach", "branch"}:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `worker_worktree.mode` must be `detach` or `branch`.")

    base_ref = str(worker_worktree.get("base_ref", DEFAULT_CONFIG["worker_worktree"]["base_ref"])).strip() or "HEAD"
    branch_prefix = str(worker_worktree.get("branch_prefix", DEFAULT_CONFIG["worker_worktree"]["branch_prefix"])).strip() or "opsx"

    rra = config.get("rra", {})
    if not isinstance(rra, dict):
        rra = {}
    gate_mode = str(rra.get("gate_mode", DEFAULT_CONFIG["rra"]["gate_mode"])).strip() or "advisory"
    if gate_mode not in {"advisory", "enforce"}:
        raise SystemExit(f"{CONFIG_RELATIVE_PATH} field `rra.gate_mode` must be `advisory` or `enforce`.")

    subagent_team = normalize_subagent_team_flags(config.get("subagent_team", {}))

    return {
        "worktree_root": worktree_root,
        "validation_commands": validation_commands,
        "worker_worktree": {
            "mode": worktree_mode,
            "base_ref": base_ref,
            "branch_prefix": branch_prefix,
        },
        "rra": {
            "gate_mode": gate_mode,
        },
        "subagent_team": subagent_team,
        "config_path": str(CONFIG_RELATIVE_PATH),
        "config_exists": config_path.exists(),
    }


def default_worker_worktree_setting(config: dict[str, Any], change: str, issue_id: str) -> str:
    return (Path(config["worktree_root"]) / change / issue_id).as_posix()


def ensure_path_within(parent: Path, target: Path) -> None:
    try:
        target.relative_to(parent)
    except ValueError as error:
        raise SystemExit(f"Path `{target}` must stay within `{parent}`.") from error


def validate_issue_worker_worktree(repo_root: Path, raw_path: str, config: dict[str, Any]) -> str:
    candidate = raw_path.strip()
    if not candidate:
        raise SystemExit("Issue frontmatter `worker_worktree` must not be empty.")

    candidate_path = Path(candidate).expanduser()
    if candidate_path.is_absolute():
        raise SystemExit("Issue frontmatter `worker_worktree` must be repo-relative, not absolute.")

    resolved_path = (repo_root / candidate_path).resolve()
    ensure_path_within(repo_root, resolved_path)

    worktree_root = resolve_repo_path(repo_root, str(config["worktree_root"]))
    ensure_path_within(worktree_root, resolved_path)
    return candidate


def issue_worker_worktree_setting(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[str, str]:
    frontmatter = read_issue_frontmatter(repo_root, change, issue_id)
    worker_worktree = frontmatter.get("worker_worktree")
    if isinstance(worker_worktree, str) and worker_worktree.strip():
        return validate_issue_worker_worktree(repo_root, worker_worktree, config), "issue_doc"
    return default_worker_worktree_setting(config, change, issue_id), "config_default"


def resolve_repo_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (repo_root / path).resolve()


def issue_worker_worktree_path(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[Path, str, str]:
    raw_path, source = issue_worker_worktree_setting(repo_root, change, issue_id, config)
    path = resolve_repo_path(repo_root, raw_path)
    return path, display_path(repo_root, path), source


def issue_validation_commands(
    repo_root: Path,
    change: str,
    issue_id: str,
    config: dict[str, Any],
) -> tuple[list[str], str]:
    frontmatter = read_issue_frontmatter(repo_root, change, issue_id)
    validation_commands = normalize_string_list(frontmatter.get("validation"))
    if validation_commands:
        return validation_commands, "issue_doc"
    return list(config["validation_commands"]), "config_default"


def display_path(repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def slugify_branch_fragment(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._/-]+", "-", value).strip("./-")
    slug = re.sub(r"/{2,}", "/", slug)
    return slug or "worker"


def worker_branch_name(config: dict[str, Any], change: str, issue_id: str) -> str:
    prefix = slugify_branch_fragment(config["worker_worktree"]["branch_prefix"]).strip("/")
    change_slug = slugify_branch_fragment(change).replace("/", "-")
    issue_slug = slugify_branch_fragment(issue_id).replace("/", "-")
    if prefix:
        return f"{prefix}/{change_slug}/{issue_slug}"
    return f"{change_slug}/{issue_slug}"


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def change_dir(repo_root: Path, change: str) -> Path:
    return repo_root / "openspec" / "changes" / change


def change_control_dir(repo_root: Path, change: str) -> Path:
    return change_dir(repo_root, change) / CONTROL_DIR_NAME


def backlog_artifact_path(repo_root: Path, change: str) -> Path:
    return change_control_dir(repo_root, change) / "BACKLOG.md"


def latest_round_artifact_path(repo_root: Path, change: str) -> Path | None:
    control_dir = change_control_dir(repo_root, change)
    if not control_dir.exists():
        return None
    matches = sorted(control_dir.glob(ROUND_FILE_PATTERN))
    if not matches:
        return None
    return matches[-1]


def read_change_control_state(repo_root: Path, change: str) -> dict[str, Any]:
    backlog_path = backlog_artifact_path(repo_root, change)
    latest_round_path = latest_round_artifact_path(repo_root, change)

    backlog_sections = extract_markdown_sections(
        backlog_path.read_text() if backlog_path.exists() else "",
        NORMALIZED_BACKLOG_SECTION_ALIASES,
    )
    must_fix_now_items = extract_open_work_items(backlog_sections.get("must_fix_now", []))
    should_fix_if_cheap_items = extract_open_work_items(backlog_sections.get("should_fix_if_cheap", []))
    defer_items = extract_open_work_items(backlog_sections.get("defer", []))

    round_sections = extract_markdown_sections(
        latest_round_path.read_text() if latest_round_path else "",
        NORMALIZED_ROUND_SECTION_ALIASES,
    )
    round_target_items = extract_section_items(round_sections.get("round_target", []))
    target_mode_items = extract_section_items(round_sections.get("target_mode", []))
    acceptance_criteria_items = extract_section_items(round_sections.get("acceptance_criteria", []))
    non_goal_items = extract_section_items(round_sections.get("non_goals", []))
    scope_in_round_items = extract_section_items(round_sections.get("scope_in_round", []))
    normalized_backlog_items = extract_section_items(round_sections.get("normalized_backlog", []))
    fixes_completed_items = extract_section_items(round_sections.get("fixes_completed", []))
    re_review_items = extract_section_items(round_sections.get("re_review_result", []))
    acceptance_lines = round_sections.get("acceptance_verdict") or round_sections.get("re_review_result", [])
    acceptance_text = collapse_section_lines(acceptance_lines)
    next_action_text = collapse_section_lines(round_sections.get("next_action", []))
    scope_text = collapse_section_lines(round_sections.get("scope_in_round", []))
    referenced_issue_ids = extract_issue_ids_from_text(" ".join([scope_text, next_action_text]))
    acceptance_status = round_acceptance_status(acceptance_text)

    return {
        "enabled": backlog_path.exists() or latest_round_path is not None,
        "backlog_path": display_path(repo_root, backlog_path) if backlog_path.exists() else "",
        "latest_round_path": display_path(repo_root, latest_round_path) if latest_round_path else "",
        "backlog": {
            "must_fix_now": {
                "open_count": len(must_fix_now_items),
                "open_items": must_fix_now_items,
            },
            "should_fix_if_cheap": {
                "open_count": len(should_fix_if_cheap_items),
                "open_items": should_fix_if_cheap_items,
            },
            "defer": {
                "open_count": len(defer_items),
                "open_items": defer_items,
            },
        },
        "must_fix_now": {
            "open_count": len(must_fix_now_items),
            "open_items": must_fix_now_items,
        },
        "latest_round": {
            "round_target": round_target_items[0] if round_target_items else "",
            "round_target_items": round_target_items,
            "target_mode": target_mode_items[0] if target_mode_items else "",
            "target_mode_items": target_mode_items,
            "acceptance_criteria": acceptance_criteria_items,
            "non_goals": non_goal_items,
            "scope_in_round": scope_in_round_items,
            "normalized_backlog": normalized_backlog_items,
            "fixes_completed": fixes_completed_items,
            "re_review_result": re_review_items,
            "acceptance_text": acceptance_text,
            "acceptance_status": acceptance_status,
            "next_action_text": next_action_text,
            "allows_verify": round_allows_verify(acceptance_text, next_action_text),
            "dispatch_gate_active": bool(latest_round_path and referenced_issue_ids),
            "referenced_issue_ids": referenced_issue_ids,
        },
    }


def evaluate_issue_dispatch_gate(
    config: dict[str, Any],
    control_state: dict[str, Any],
    issue_id: str,
) -> dict[str, Any]:
    gate_mode = str(config.get("rra", {}).get("gate_mode", "advisory")).strip() or "advisory"
    normalized_issue_id = issue_id.strip()
    gate: dict[str, Any] = {
        "mode": gate_mode,
        "issue_id": normalized_issue_id,
        "active": False,
        "blocking": False,
        "enforced": False,
        "allowed": True,
        "status": "not_applicable",
        "action": "",
        "reason": "",
    }

    if not control_state.get("enabled"):
        return gate

    must_fix_now_open = int(control_state.get("must_fix_now", {}).get("open_count", 0) or 0)
    if must_fix_now_open > 0:
        gate.update(
            {
                "active": True,
                "blocking": True,
                "allowed": False,
                "status": "blocked_by_backlog",
                "action": "resolve_round_backlog",
                "reason": f"当前 RRA backlog 仍有 {must_fix_now_open} 个 Must fix now 未处理。",
            }
        )
        gate["enforced"] = gate["blocking"] and gate_mode == "enforce"
        return gate

    latest_round = control_state.get("latest_round", {})
    dispatchable_issue_ids = {
        str(candidate).strip()
        for candidate in latest_round.get("referenced_issue_ids", [])
        if str(candidate).strip()
    }
    if latest_round.get("dispatch_gate_active") and dispatchable_issue_ids:
        if normalized_issue_id in dispatchable_issue_ids:
            gate.update(
                {
                    "active": True,
                    "allowed": True,
                    "status": "approved_for_dispatch",
                    "action": "dispatch_next_issue",
                    "reason": "当前 round 已批准该 issue 派发。",
                }
            )
        else:
            gate.update(
                {
                    "active": True,
                    "blocking": True,
                    "allowed": False,
                    "status": "blocked_by_round_scope",
                    "action": "update_round_scope",
                    "reason": "当前 round 未批准该 issue 派发，请更新 round scope。",
                }
            )

    gate["enforced"] = gate["blocking"] and gate_mode == "enforce"
    return gate


def ensure_issue_dispatch_allowed(
    config: dict[str, Any],
    control_state: dict[str, Any],
    issue_id: str,
) -> dict[str, Any]:
    gate = evaluate_issue_dispatch_gate(config, control_state, issue_id)
    if gate.get("enforced"):
        raise SystemExit(f"Dispatch blocked by RRA gate: {gate.get('reason', 'unknown reason')}")
    return gate


def change_runs_dir(repo_root: Path, change: str) -> Path:
    runs_dir = change_dir(repo_root, change) / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir


def issue_progress_path(repo_root: Path, change: str, issue_id: str) -> Path:
    return change_dir(repo_root, change) / "issues" / f"{issue_id}.progress.json"


def run_artifact_path(repo_root: Path, change: str, run_id: str) -> Path:
    return change_runs_dir(repo_root, change) / f"{run_id}.json"
