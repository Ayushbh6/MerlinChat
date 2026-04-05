import argparse
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_root, ".env.local"))

CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
SCOPES = ["https://www.googleapis.com/auth/calendar"]
TOKEN_FILE = "/Users/aparajitbhattacharya/Library/CloudStorage/OneDrive-Personal/MyDocuments/Ayush-Personal/Calender/token.json"
DEFAULT_TIMEZONE = "Europe/Vienna"
DASM_COURSE_NAME = "Data Acquisition and Survey Methods"
DASM_LOCATION = "HS 18 Czuber - MB"
DASM_DESCRIPTION = "Vorlesung mit Übung"
DIC_COURSE_NAME = "Data-intensive Computing"
DIC_LOCATION = "FAV Hörsaal 1 Helmut Veith - INF"
DIC_DESCRIPTION = "194.184 Data-intensive Computing"
ILS_COURSE_NAME = "Interdisciplinary Lecture Series on Data Science"
ILS_LOCATION = "EI 5 Hohenegg HS"
ILS_DESCRIPTION = "Interdisciplinary Lecture Series on Data Science"

CLIENT_CONFIG = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uris": ["http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}


@dataclass(frozen=True)
class ExpectedEvent:
    summary_keyword: str
    start: datetime
    end: datetime
    location: str
    kind: str

    @property
    def date_str(self) -> str:
        return self.start.strftime("%Y-%m-%d")

    @property
    def time_str(self) -> str:
        return f"{self.start.strftime('%H:%M')}-{self.end.strftime('%H:%M')}"


@dataclass
class EventComparison:
    expected: ExpectedEvent
    matched_event: dict | None
    issues: list[str]


@dataclass
class AnalysisResult:
    expected_events: list[ExpectedEvent]
    actual_events: list[dict]
    comparisons: list[EventComparison]
    missing: list[EventComparison]
    hard_mismatched: list[EventComparison]
    soft_mismatched: list[EventComparison]
    unmatched_actual: list[dict]


def get_credentials():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as token_file:
            token_file.write(creds.to_json())
    return creds


def get_calendar_service():
    creds = get_credentials()
    return build("calendar", "v3", credentials=creds)


def coerce_datetime(value: str, tz_name: str) -> datetime:
    dt = datetime.fromisoformat(value)
    tz = ZoneInfo(tz_name)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def coerce_date(value: str) -> date:
    return date.fromisoformat(value)


def event_label(event: dict, tz_name: str) -> str:
    tz = ZoneInfo(tz_name)
    start = parse_event_dt(event.get("start", {}), tz)
    end = parse_event_dt(event.get("end", {}), tz)
    if event.get("start", {}).get("date"):
        start_str = event["start"]["date"]
        end_raw = event.get("end", {}).get("date", "")
        end_str = ""
        if end_raw:
            end_str = f" -> {(date.fromisoformat(end_raw) - timedelta(days=1)).isoformat()}"
        time_part = f"{start_str}{end_str} (all-day)"
    else:
        start_str = start.isoformat() if start else "?"
        end_str = end.isoformat() if end else "?"
        time_part = f"{start_str} -> {end_str}"
    return (
        f"{event.get('id', '(no id)')} | {time_part} | "
        f"{event.get('summary', '(no summary)')} | {event.get('location', '')}"
    )


def print_event(event: dict, tz_name: str) -> None:
    print(event_label(event, tz_name))
    description = event.get("description")
    if description:
        print(f"  description: {description}")
    extended = event.get("extendedProperties", {}).get("private", {})
    if extended:
        print(f"  tags: {extended}")
    reminders = event.get("reminders", {})
    if reminders.get("useDefault") is False:
        print(f"  reminders: {reminders.get('overrides', [])}")


def parse_private_tags(raw_tags: list[str] | None) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for item in raw_tags or []:
        if "=" not in item:
            raise ValueError(f"Invalid tag '{item}'. Expected KEY=VALUE.")
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise ValueError(f"Invalid tag '{item}'. Key cannot be empty.")
        parsed[key] = value
    return parsed


def build_reminders(reminder_minutes: list[int] | None) -> dict:
    if not reminder_minutes:
        return {"useDefault": True}
    unique_minutes = sorted(set(reminder_minutes), reverse=True)
    return {
        "useDefault": False,
        "overrides": [{"method": "popup", "minutes": minutes} for minutes in unique_minutes],
    }


def build_event_body(args: argparse.Namespace, require_time: bool) -> dict:
    if args.all_day:
        if not args.start:
            raise ValueError("--start is required for all-day events.")
        start_date = coerce_date(args.start)
        end_date = coerce_date(args.end) if args.end else start_date + timedelta(days=1)
        if end_date <= start_date:
            end_date = start_date + timedelta(days=1)
        start_payload = {"date": start_date.isoformat()}
        end_payload = {"date": end_date.isoformat()}
    else:
        if require_time and (not args.start or not args.end):
            raise ValueError("--start and --end are required for timed events.")
        start_payload = None
        end_payload = None
        if args.start:
            start_dt = coerce_datetime(args.start, args.timezone)
            start_payload = {
                "dateTime": start_dt.isoformat(),
                "timeZone": args.timezone,
            }
        if args.end:
            end_dt = coerce_datetime(args.end, args.timezone)
            end_payload = {
                "dateTime": end_dt.isoformat(),
                "timeZone": args.timezone,
            }
        if require_time and start_payload and end_payload:
            start_dt = coerce_datetime(args.start, args.timezone)
            end_dt = coerce_datetime(args.end, args.timezone)
            if end_dt <= start_dt:
                raise ValueError("--end must be after --start.")

    body: dict = {}
    if args.summary is not None:
        body["summary"] = args.summary
    if args.description is not None:
        body["description"] = args.description
    if args.location is not None:
        body["location"] = args.location
    if start_payload is not None:
        body["start"] = start_payload
    if end_payload is not None:
        body["end"] = end_payload

    private_tags = parse_private_tags(args.tag)
    if private_tags:
        body["extendedProperties"] = {"private": private_tags}

    if require_time or args.reminder:
        body["reminders"] = build_reminders(args.reminder)

    return body


def fetch_event(calendar_id: str, event_id: str) -> dict:
    service = get_calendar_service()
    return service.events().get(calendarId=calendar_id, eventId=event_id).execute()


def find_duplicate_candidates(
    events: list[dict],
    args: argparse.Namespace,
) -> list[dict]:
    candidates = events
    if args.summary:
        summary_cmp = normalize_text(args.summary)
        candidates = [
            event for event in candidates
            if normalize_text(event.get("summary")) == summary_cmp
        ]

    private_tags = parse_private_tags(args.tag)
    if private_tags:
        filtered: list[dict] = []
        for event in candidates:
            event_tags = event.get("extendedProperties", {}).get("private", {})
            if all(event_tags.get(key) == value for key, value in private_tags.items()):
                filtered.append(event)
        candidates = filtered

    if args.start and args.end:
        tz = ZoneInfo(args.timezone)
        if args.all_day:
            start_date = coerce_date(args.start)
            end_date = coerce_date(args.end) if args.end else start_date + timedelta(days=1)
            candidates = [
                event for event in candidates
                if event.get("start", {}).get("date") == start_date.isoformat()
                and event.get("end", {}).get("date") == end_date.isoformat()
            ]
        else:
            start_dt = coerce_datetime(args.start, args.timezone)
            end_dt = coerce_datetime(args.end, args.timezone)
            candidates = [
                event for event in candidates
                if event_matches_slot(event, start_dt, end_dt, tz)
            ]

    return candidates


def list_events(calendar_id: str, args: argparse.Namespace) -> int:
    if not args.start or not args.end:
        raise ValueError("--start and --end are required for --list-events.")
    if args.all_day:
        raise ValueError("--all-day is not supported with --list-events.")

    time_min = coerce_datetime(args.start, args.timezone)
    time_max = coerce_datetime(args.end, args.timezone)
    if time_max <= time_min:
        raise ValueError("--end must be after --start.")

    events = fetch_events(calendar_id, time_min, time_max)
    if args.query:
        query_cmp = normalize_text(args.query)
        events = [
            event for event in events
            if query_cmp in normalize_text(
                f"{event.get('summary', '')} {event.get('description', '')} {event.get('location', '')}"
            )
        ]

    print(f"\n=== Calendar Events ({len(events)}) ===")
    for event in events:
        print_event(event, args.timezone)
    return 0


def create_event(calendar_id: str, args: argparse.Namespace) -> int:
    if not args.summary:
        raise ValueError("--summary is required for --create-event.")
    body = build_event_body(args, require_time=True)
    service = get_calendar_service()
    created = service.events().insert(calendarId=calendar_id, body=body).execute()
    print("Created event:")
    print_event(created, args.timezone)
    return 0


def update_event(calendar_id: str, args: argparse.Namespace) -> int:
    if not args.event_id:
        raise ValueError("--event-id is required for --update-event.")
    body = build_event_body(args, require_time=False)
    if not body:
        raise ValueError("Provide at least one field to update.")
    service = get_calendar_service()
    updated = service.events().patch(
        calendarId=calendar_id,
        eventId=args.event_id,
        body=body,
    ).execute()
    print("Updated event:")
    print_event(updated, args.timezone)
    return 0


def delete_event(calendar_id: str, args: argparse.Namespace) -> int:
    if not args.event_id:
        raise ValueError("--event-id is required for --delete-event.")
    existing = fetch_event(calendar_id, args.event_id)
    service = get_calendar_service()
    service.events().delete(calendarId=calendar_id, eventId=args.event_id).execute()
    print("Deleted event:")
    print_event(existing, args.timezone)
    return 0


def upsert_event(calendar_id: str, args: argparse.Namespace) -> int:
    if not args.summary:
        raise ValueError("--summary is required for --upsert-event.")
    if not args.start or not args.end:
        raise ValueError("--start and --end are required for --upsert-event.")
    if args.all_day:
        range_start = datetime.combine(coerce_date(args.start), time(0, 0), tzinfo=ZoneInfo(args.timezone))
        range_end = datetime.combine(coerce_date(args.end), time(23, 59), tzinfo=ZoneInfo(args.timezone))
    else:
        start_dt = coerce_datetime(args.start, args.timezone)
        end_dt = coerce_datetime(args.end, args.timezone)
        range_start = start_dt - timedelta(days=1)
        range_end = end_dt + timedelta(days=1)

    existing = fetch_events(calendar_id, range_start, range_end)
    matches = find_duplicate_candidates(existing, args)

    if len(matches) > 1:
        print("Multiple matching events found. Refusing to upsert.")
        for event in matches:
            print_event(event, args.timezone)
        return 1

    if len(matches) == 1:
        args.event_id = matches[0]["id"]
        return update_event(calendar_id, args)

    return create_event(calendar_id, args)


def normalize_text(text: str | None) -> str:
    return " ".join((text or "").lower().split())


def normalize_for_compare(text: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-z0-9]+", " ", ascii_only.lower())
    return " ".join(cleaned.split())


def location_match_quality(expected: str, actual: str | None) -> tuple[bool, str | None]:
    expected_cmp = normalize_for_compare(expected)
    actual_cmp = normalize_for_compare(actual)

    if expected_cmp == actual_cmp:
        return True, None

    expected_tokens = set(expected_cmp.split())
    actual_tokens = set(actual_cmp.split())
    overlap = len(expected_tokens & actual_tokens)

    if expected_cmp and actual_cmp and (expected_cmp in actual_cmp or actual_cmp in expected_cmp):
        return True, (
            f"minor location variance (expected '{expected}', got '{actual or ''}')"
        )

    if overlap >= max(2, min(len(expected_tokens), len(actual_tokens)) - 1):
        return True, (
            f"minor location variance (expected '{expected}', got '{actual or ''}')"
        )

    return False, f"location mismatch (expected '{expected}', got '{actual or ''}')"


def parse_event_dt(value: dict, fallback_tz: ZoneInfo) -> datetime | None:
    if value.get("dateTime"):
        dt = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return dt.replace(tzinfo=fallback_tz)
        return dt.astimezone(fallback_tz)
    if value.get("date"):
        d = date.fromisoformat(value["date"])
        return datetime.combine(d, time(0, 0), tzinfo=fallback_tz)
    return None


def event_contains_course(event: dict, course_name: str) -> bool:
    text = normalize_text(f"{event.get('summary', '')} {event.get('description', '')}")
    return normalize_text(course_name) in text


def event_matches_slot(event: dict, start: datetime, end: datetime, tz: ZoneInfo) -> bool:
    start_dt = parse_event_dt(event.get("start", {}), tz)
    end_dt = parse_event_dt(event.get("end", {}), tz)
    if start_dt is None or end_dt is None:
        return False
    return within_tolerance(start_dt, start, minutes=1) and within_tolerance(end_dt, end, minutes=1)


def create_dt(d: date, hour: int, minute: int, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, time(hour, minute), tzinfo=tz)


def generate_weekly_dates(start: date, end: date, weekday: int) -> list[date]:
    dates: list[date] = []
    cursor = start
    while cursor.weekday() != weekday:
        cursor += timedelta(days=1)
    while cursor <= end:
        dates.append(cursor)
        cursor += timedelta(days=7)
    return dates


def build_expected_events(course_name: str, tz: ZoneInfo) -> list[ExpectedEvent]:
    keyword = course_name.lower()
    expected: list[ExpectedEvent] = []

    weekly_dates = generate_weekly_dates(
        start=date(2026, 3, 4),
        end=date(2026, 6, 24),
        weekday=2,
    )
    for lecture_date in weekly_dates:
        expected.append(
            ExpectedEvent(
                summary_keyword=keyword,
                start=create_dt(lecture_date, 12, 0, tz),
                end=create_dt(lecture_date, 14, 0, tz),
                location="FAV Hörsaal 1 Helmut Veith - INF",
                kind="Lecture",
            )
        )

    specials = [
        (date(2026, 5, 11), 15, 0, 17, 0, "FAV Hörsaal 3 Zemanek (Seminarraum Zemanek)", "Guest Lecture"),
        (date(2026, 6, 15), 12, 0, 14, 0, "Seminarraum FAV 01 C (Seminarraum 188/2)", "Project presentations"),
        (date(2026, 6, 17), 14, 0, 16, 0, "Seminarraum FAV 01 C (Seminarraum 188/2)", "Project presentations"),
        (date(2026, 6, 19), 12, 0, 17, 0, "InfLab Q*bert", "Submission Talks"),
        (date(2026, 6, 19), 12, 0, 17, 0, "InLab Frogger", "Submission Talks"),
        (date(2026, 9, 17), 12, 0, 14, 0, "FAV Hörsaal 1 Helmut Veith - INF", "2nd written exam"),
    ]

    for d, sh, sm, eh, em, location, kind in specials:
        expected.append(
            ExpectedEvent(
                summary_keyword=keyword,
                start=create_dt(d, sh, sm, tz),
                end=create_dt(d, eh, em, tz),
                location=location,
                kind=kind,
            )
        )

    return sorted(expected, key=lambda e: e.start)


def fetch_events(calendar_id: str, time_min: datetime, time_max: datetime) -> list[dict]:
    service = get_calendar_service()

    items: list[dict] = []
    page_token = None

    while True:
        response = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min.isoformat(),
                timeMax=time_max.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=2500,
                pageToken=page_token,
            )
            .execute()
        )

        for event in response.get("items", []):
            if event.get("status") == "cancelled":
                continue
            items.append(event)

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return items


def within_tolerance(actual: datetime, expected: datetime, minutes: int = 5) -> bool:
    return abs((actual - expected).total_seconds()) <= minutes * 60


def find_best_match(
    expected: ExpectedEvent,
    candidates: list[dict],
    used_ids: set[str],
    tz: ZoneInfo,
    course_name: str,
) -> EventComparison:
    best_event = None
    best_score = -1
    best_issues: list[str] = []

    for event in candidates:
        event_id = event.get("id")
        if not event_id or event_id in used_ids:
            continue

        start_dt = parse_event_dt(event.get("start", {}), tz)
        end_dt = parse_event_dt(event.get("end", {}), tz)
        if start_dt is None or end_dt is None:
            continue

        if not within_tolerance(start_dt, expected.start) or not within_tolerance(end_dt, expected.end):
            continue

        issues: list[str] = []
        score = 2

        location_ok, location_note = location_match_quality(expected.location, event.get("location"))
        if not location_ok and location_note:
            issues.append(location_note)
        elif location_note:
            issues.append(location_note)
            score += 1
        else:
            score += 1

        combined_text = normalize_text(
            f"{event.get('summary', '')} {event.get('description', '')}"
        )
        if normalize_text(expected.kind) not in combined_text:
            issues.append(
                f"type/detail mismatch (expected to contain '{expected.kind}' in summary or description)"
            )
        else:
            score += 1

        course_kw = normalize_text(course_name)
        if course_kw not in combined_text:
            issues.append("course tag missing in summary/description")
        else:
            score += 1

        if score > best_score:
            best_event = event
            best_score = score
            best_issues = issues

    if not best_event:
        return EventComparison(expected=expected, matched_event=None, issues=["missing event"])

    used_ids.add(best_event["id"])
    return EventComparison(expected=expected, matched_event=best_event, issues=best_issues)


def analyze_schedule(course_name: str, calendar_id: str, tz_name: str) -> AnalysisResult:
    tz = ZoneInfo(tz_name)
    expected_events = build_expected_events(course_name=course_name, tz=tz)

    time_min = create_dt(date(2026, 3, 1), 0, 0, tz)
    time_max = create_dt(date(2026, 9, 30), 23, 59, tz)
    actual_events = fetch_events(
        calendar_id=calendar_id,
        time_min=time_min,
        time_max=time_max,
    )

    used_ids: set[str] = set()
    comparisons = [
        find_best_match(exp, actual_events, used_ids, tz, course_name) for exp in expected_events
    ]

    course_kw = normalize_text(course_name)
    unmatched_actual = [
        e
        for e in actual_events
        if e.get("id") not in used_ids
        and course_kw in normalize_text(f"{e.get('summary', '')} {e.get('description', '')}")
    ]

    missing = [c for c in comparisons if c.matched_event is None]
    mismatched = [c for c in comparisons if c.matched_event is not None and c.issues]

    soft_markers = (
        "minor location variance",
        "type/detail mismatch",
    )

    hard_mismatched: list[EventComparison] = []
    soft_mismatched: list[EventComparison] = []
    for item in mismatched:
        if any(
            not any(issue.startswith(marker) for marker in soft_markers)
            for issue in item.issues
        ):
            hard_mismatched.append(item)
        else:
            soft_mismatched.append(item)

    return AnalysisResult(
        expected_events=expected_events,
        actual_events=actual_events,
        comparisons=comparisons,
        missing=missing,
        hard_mismatched=hard_mismatched,
        soft_mismatched=soft_mismatched,
        unmatched_actual=unmatched_actual,
    )


def verify_schedule(course_name: str, calendar_id: str, tz_name: str) -> int:
    analysis = analyze_schedule(course_name, calendar_id, tz_name)
    expected_events = analysis.expected_events
    comparisons = analysis.comparisons
    missing = analysis.missing
    hard_mismatched = analysis.hard_mismatched
    soft_mismatched = analysis.soft_mismatched
    unmatched_actual = analysis.unmatched_actual
    correct = [c for c in comparisons if c.matched_event is not None and not c.issues]
    mismatched = [c for c in comparisons if c.matched_event is not None and c.issues]

    print("\n=== Information Visualization Calendar Verification ===")
    print(f"Expected events : {len(expected_events)}")
    print(f"Matched correct : {len(correct)}")
    print(f"Matched w/issue : {len(mismatched)}")
    print(f"  - Hard issues : {len(hard_mismatched)}")
    print(f"  - Soft issues : {len(soft_mismatched)}")
    print(f"Missing events  : {len(missing)}")
    print(f"Unexpected extras (course-tagged): {len(unmatched_actual)}")

    if missing:
        print("\n-- Missing --")
        for item in missing:
            e = item.expected
            print(f"  {e.date_str} {e.time_str} | {e.location} | {e.kind}")

    if hard_mismatched:
        print("\n-- Hard Mismatches --")
        for item in hard_mismatched:
            e = item.expected
            print(f"  {e.date_str} {e.time_str} | {e.location}")
            for issue in item.issues:
                print(f"    - {issue}")

    if soft_mismatched:
        print("\n-- Soft Mismatches (likely acceptable variants) --")
        for item in soft_mismatched:
            e = item.expected
            print(f"  {e.date_str} {e.time_str} | {e.location}")
            for issue in item.issues:
                print(f"    - {issue}")

    if unmatched_actual:
        print("\n-- Unexpected extras (contains course name but not expected slot) --")
        for event in unmatched_actual:
            start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
            end = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
            print(
                f"  {start} -> {end} | {event.get('summary', '(no summary)')} | {event.get('location', '')}"
            )

    all_good = not missing and not hard_mismatched and not unmatched_actual
    if all_good:
        if soft_mismatched:
            print(
                "\n✅ PASS: All expected events were found with no hard issues. "
                "Only soft differences remain."
            )
        else:
            print(
                "\n✅ PASS: All Information Visualization events are present and aligned with the expected schedule."
            )
        return 0

    print("\n❌ FAIL: Differences found. Review missing/mismatch/extra sections above.")
    return 1


def repair_schedule(course_name: str, calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    analysis = analyze_schedule(course_name, calendar_id, tz_name)
    service = get_calendar_service()

    created_count = 0
    patched_count = 0

    missing_exam = [
        item for item in analysis.missing
        if normalize_text(item.expected.kind) == normalize_text("2nd written exam")
    ]

    for item in missing_exam:
        expected = item.expected
        body = {
            "summary": f"{course_name} - 2nd written exam",
            "description": (
                f"{course_name}\n"
                "2nd written exam\n"
                "Auto-repaired by verification script."
            ),
            "location": expected.location,
            "start": {
                "dateTime": expected.start.isoformat(),
                "timeZone": tz_name,
            },
            "end": {
                "dateTime": expected.end.isoformat(),
                "timeZone": tz_name,
            },
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 30}],
            },
        }
        service.events().insert(calendarId=calendar_id, body=body).execute()
        created_count += 1
        print(f"Created missing exam event: {expected.date_str} {expected.time_str}")

    frogger_hard = [
        item for item in analysis.hard_mismatched
        if normalize_for_compare(item.expected.location) == normalize_for_compare("InLab Frogger")
        and item.matched_event is not None
    ]

    for item in frogger_hard:
        event_id = item.matched_event.get("id")
        if not event_id:
            continue
        service.events().patch(
            calendarId=calendar_id,
            eventId=event_id,
            body={"location": "InLab Frogger"},
        ).execute()
        patched_count += 1
        print(f"Patched Frogger location on event id: {event_id}")

    if created_count == 0 and patched_count == 0:
        print("No targeted repair actions were necessary.")
    else:
        print(
            f"Repair complete. Created: {created_count}, Patched: {patched_count}"
        )

    return 0


def data_acquisition_slots(tz: ZoneInfo) -> list[tuple[datetime, datetime]]:
    dates = [
        date(2026, 3, 2),
        date(2026, 3, 9),
        date(2026, 3, 16),
        date(2026, 3, 23),
        date(2026, 4, 13),
        date(2026, 4, 20),
        date(2026, 4, 27),
        date(2026, 5, 4),
        date(2026, 5, 11),
        date(2026, 5, 18),
        date(2026, 6, 1),
        date(2026, 6, 8),
        date(2026, 6, 15),
        date(2026, 6, 22),
        date(2026, 6, 29),
    ]
    return [(create_dt(d, 14, 0, tz), create_dt(d, 16, 0, tz)) for d in dates]


def add_data_acquisition_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    service = get_calendar_service()

    slots = data_acquisition_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    created = 0
    skipped_existing = 0

    for start_at, end_at in slots:
        already_exists = any(
            event_contains_course(event, DASM_COURSE_NAME)
            and event_matches_slot(event, start_at, end_at, tz)
            for event in existing
        )

        if already_exists:
            skipped_existing += 1
            continue

        body = {
            "summary": DASM_COURSE_NAME,
            "description": DASM_DESCRIPTION,
            "location": DASM_LOCATION,
            "start": {
                "dateTime": start_at.isoformat(),
                "timeZone": tz_name,
            },
            "end": {
                "dateTime": end_at.isoformat(),
                "timeZone": tz_name,
            },
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 15}],
            },
        }
        created_event = service.events().insert(calendarId=calendar_id, body=body).execute()
        existing.append(created_event)
        created += 1

    print("\n=== Data Acquisition and Survey Methods Import ===")
    print(f"Target slots : {len(slots)}")
    print(f"Created      : {created}")
    print(f"Already there: {skipped_existing}")

    if created == 0:
        print("No new events needed; all slots were already present.")
    else:
        print("Events successfully added.")

    return 0


def verify_data_acquisition_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    slots = data_acquisition_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    matched_ids: set[str] = set()
    missing_slots: list[tuple[datetime, datetime]] = []

    for start_at, end_at in slots:
        match = next(
            (
                event
                for event in existing
                if event.get("id") not in matched_ids
                and event_contains_course(event, DASM_COURSE_NAME)
                and event_matches_slot(event, start_at, end_at, tz)
            ),
            None,
        )
        if match:
            event_id = match.get("id")
            if event_id:
                matched_ids.add(event_id)
        else:
            missing_slots.append((start_at, end_at))

    extras = [
        event
        for event in existing
        if event_contains_course(event, DASM_COURSE_NAME)
        and event.get("id") not in matched_ids
    ]

    print("\n=== Data Acquisition and Survey Methods Verification ===")
    print(f"Expected slots : {len(slots)}")
    print(f"Matched slots  : {len(slots) - len(missing_slots)}")
    print(f"Missing slots  : {len(missing_slots)}")
    print(f"Extra events   : {len(extras)}")

    if missing_slots:
        print("\n-- Missing Slots --")
        for start_at, end_at in missing_slots:
            print(f"  {start_at.strftime('%Y-%m-%d %H:%M')} -> {end_at.strftime('%H:%M')}")

    if extras:
        print("\n-- Extra DASM Events (not in expected slots) --")
        for event in extras:
            start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
            end = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
            print(f"  {start} -> {end} | {event.get('summary', '')} | {event.get('location', '')}")

    if not missing_slots and not extras:
        print("\n✅ PASS: All DASM events are present and correctly slotted.")
        return 0

    print("\n❌ FAIL: DASM schedule has missing or extra events.")
    return 1


def data_intensive_slots(tz: ZoneInfo) -> list[tuple[datetime, datetime]]:
    dates = [
        date(2026, 3, 13),
        date(2026, 3, 20),
        date(2026, 3, 27),
        date(2026, 4, 17),
        date(2026, 4, 24),
        date(2026, 5, 8),
        date(2026, 5, 22),
        date(2026, 5, 29),
        date(2026, 6, 5),
        date(2026, 6, 12),
        date(2026, 6, 19),
        date(2026, 6, 26),
    ]
    return [(create_dt(d, 12, 0, tz), create_dt(d, 14, 0, tz)) for d in dates]


def add_data_intensive_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    service = get_calendar_service()

    slots = data_intensive_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    created = 0
    skipped_existing = 0

    for start_at, end_at in slots:
        already_exists = any(
            event_contains_course(event, DIC_COURSE_NAME)
            and event_matches_slot(event, start_at, end_at, tz)
            for event in existing
        )

        if already_exists:
            skipped_existing += 1
            continue

        body = {
            "summary": DIC_COURSE_NAME,
            "description": DIC_DESCRIPTION,
            "location": DIC_LOCATION,
            "start": {
                "dateTime": start_at.isoformat(),
                "timeZone": tz_name,
            },
            "end": {
                "dateTime": end_at.isoformat(),
                "timeZone": tz_name,
            },
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 15}],
            },
        }
        created_event = service.events().insert(calendarId=calendar_id, body=body).execute()
        existing.append(created_event)
        created += 1

    print("\n=== Data-intensive Computing Import ===")
    print(f"Target slots : {len(slots)}")
    print(f"Created      : {created}")
    print(f"Already there: {skipped_existing}")

    if created == 0:
        print("No new events needed; all slots were already present.")
    else:
        print("Events successfully added.")

    return 0


def verify_data_intensive_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    slots = data_intensive_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    matched_ids: set[str] = set()
    missing_slots: list[tuple[datetime, datetime]] = []

    for start_at, end_at in slots:
        match = next(
            (
                event
                for event in existing
                if event.get("id") not in matched_ids
                and event_contains_course(event, DIC_COURSE_NAME)
                and event_matches_slot(event, start_at, end_at, tz)
            ),
            None,
        )
        if match:
            event_id = match.get("id")
            if event_id:
                matched_ids.add(event_id)
        else:
            missing_slots.append((start_at, end_at))

    extras = [
        event
        for event in existing
        if event_contains_course(event, DIC_COURSE_NAME)
        and event.get("id") not in matched_ids
    ]

    print("\n=== Data-intensive Computing Verification ===")
    print(f"Expected slots : {len(slots)}")
    print(f"Matched slots  : {len(slots) - len(missing_slots)}")
    print(f"Missing slots  : {len(missing_slots)}")
    print(f"Extra events   : {len(extras)}")

    if missing_slots:
        print("\n-- Missing Slots --")
        for start_at, end_at in missing_slots:
            print(f"  {start_at.strftime('%Y-%m-%d %H:%M')} -> {end_at.strftime('%H:%M')}")

    if extras:
        print("\n-- Extra DIC Events (not in expected slots) --")
        for event in extras:
            start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
            end = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
            print(f"  {start} -> {end} | {event.get('summary', '')} | {event.get('location', '')}")

    if not missing_slots and not extras:
        print("\n✅ PASS: All Data-intensive Computing events are present and correctly slotted.")
        return 0

    print("\n❌ FAIL: Data-intensive Computing schedule has missing or extra events.")
    return 1


def interdisciplinary_series_slots(tz: ZoneInfo) -> list[tuple[datetime, datetime, str]]:
    return [
        (create_dt(date(2026, 3, 6), 13, 0, tz), create_dt(date(2026, 3, 6), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 3, 6), 14, 0, tz), create_dt(date(2026, 3, 6), 15, 0, tz), "Interdisciplinary Lecture Series"),
        (create_dt(date(2026, 3, 13), 13, 0, tz), create_dt(date(2026, 3, 13), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 3, 20), 13, 0, tz), create_dt(date(2026, 3, 20), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 3, 27), 13, 0, tz), create_dt(date(2026, 3, 27), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 4, 17), 13, 0, tz), create_dt(date(2026, 4, 17), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 4, 24), 13, 0, tz), create_dt(date(2026, 4, 24), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 5, 8), 13, 0, tz), create_dt(date(2026, 5, 8), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 5, 22), 13, 0, tz), create_dt(date(2026, 5, 22), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 5, 29), 13, 0, tz), create_dt(date(2026, 5, 29), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 6, 5), 13, 0, tz), create_dt(date(2026, 6, 5), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 6, 12), 13, 0, tz), create_dt(date(2026, 6, 12), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 6, 19), 13, 0, tz), create_dt(date(2026, 6, 19), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 6, 26), 13, 0, tz), create_dt(date(2026, 6, 26), 14, 0, tz), ILS_DESCRIPTION),
        (create_dt(date(2026, 6, 26), 14, 0, tz), create_dt(date(2026, 6, 26), 15, 0, tz), "Final discussion"),
    ]


def add_interdisciplinary_series_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    service = get_calendar_service()

    slots = interdisciplinary_series_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    created = 0
    skipped_existing = 0

    for start_at, end_at, description in slots:
        already_exists = any(
            event_contains_course(event, ILS_COURSE_NAME)
            and event_matches_slot(event, start_at, end_at, tz)
            for event in existing
        )

        if already_exists:
            skipped_existing += 1
            continue

        body = {
            "summary": ILS_COURSE_NAME,
            "description": description,
            "location": ILS_LOCATION,
            "start": {
                "dateTime": start_at.isoformat(),
                "timeZone": tz_name,
            },
            "end": {
                "dateTime": end_at.isoformat(),
                "timeZone": tz_name,
            },
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 15}],
            },
        }
        created_event = service.events().insert(calendarId=calendar_id, body=body).execute()
        existing.append(created_event)
        created += 1

    print("\n=== Interdisciplinary Lecture Series on Data Science Import ===")
    print(f"Target slots : {len(slots)}")
    print(f"Created      : {created}")
    print(f"Already there: {skipped_existing}")

    if created == 0:
        print("No new events needed; all slots were already present.")
    else:
        print("Events successfully added.")

    return 0


def verify_interdisciplinary_series_course(calendar_id: str, tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    slots = interdisciplinary_series_slots(tz)
    range_start = create_dt(date(2026, 3, 1), 0, 0, tz)
    range_end = create_dt(date(2026, 7, 1), 0, 0, tz)
    existing = fetch_events(calendar_id, range_start, range_end)

    matched_ids: set[str] = set()
    missing_slots: list[tuple[datetime, datetime]] = []

    for start_at, end_at, _ in slots:
        match = next(
            (
                event
                for event in existing
                if event.get("id") not in matched_ids
                and event_contains_course(event, ILS_COURSE_NAME)
                and event_matches_slot(event, start_at, end_at, tz)
            ),
            None,
        )
        if match:
            event_id = match.get("id")
            if event_id:
                matched_ids.add(event_id)
        else:
            missing_slots.append((start_at, end_at))

    extras = [
        event
        for event in existing
        if event_contains_course(event, ILS_COURSE_NAME)
        and event.get("id") not in matched_ids
    ]

    print("\n=== Interdisciplinary Lecture Series on Data Science Verification ===")
    print(f"Expected slots : {len(slots)}")
    print(f"Matched slots  : {len(slots) - len(missing_slots)}")
    print(f"Missing slots  : {len(missing_slots)}")
    print(f"Extra events   : {len(extras)}")

    if missing_slots:
        print("\n-- Missing Slots --")
        for start_at, end_at in missing_slots:
            print(f"  {start_at.strftime('%Y-%m-%d %H:%M')} -> {end_at.strftime('%H:%M')}")

    if extras:
        print("\n-- Extra ILS Events (not in expected slots) --")
        for event in extras:
            start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
            end = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
            print(f"  {start} -> {end} | {event.get('summary', '')} | {event.get('location', '')}")

    if not missing_slots and not extras:
        print("\n✅ PASS: All ILS events are present and correctly slotted.")
        return 0

    print("\n❌ FAIL: ILS schedule has missing or extra events.")
    return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Google Calendar helper for TU Wien semester scheduling."
    )
    parser.add_argument("--course", default="Information Visualization", help="Course name to match")
    parser.add_argument("--calendar-id", default="primary", help="Google Calendar ID")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE, help="IANA timezone")
    parser.add_argument("--start", help="ISO datetime or date, depending on command")
    parser.add_argument("--end", help="ISO datetime or date, depending on command")
    parser.add_argument("--summary", help="Event summary/title")
    parser.add_argument("--description", help="Event description")
    parser.add_argument("--location", help="Event location")
    parser.add_argument("--event-id", help="Google Calendar event id")
    parser.add_argument("--query", help="Free-text filter for list output")
    parser.add_argument("--all-day", action="store_true", help="Treat start/end as all-day dates")
    parser.add_argument(
        "--reminder",
        action="append",
        type=int,
        help="Popup reminder minutes before the event. Repeatable.",
    )
    parser.add_argument(
        "--tag",
        action="append",
        help="Private extended property KEY=VALUE. Repeatable.",
    )
    parser.add_argument("--list-events", action="store_true", help="List events in a date range")
    parser.add_argument("--create-event", action="store_true", help="Create a generic event")
    parser.add_argument("--update-event", action="store_true", help="Patch an existing event")
    parser.add_argument("--delete-event", action="store_true", help="Delete an event")
    parser.add_argument("--upsert-event", action="store_true", help="Create or update a matching event")
    parser.add_argument("--repair", action="store_true", help="Apply targeted fixes for known hard issues")
    parser.add_argument("--verify-after-repair", action="store_true", help="Run verification again after repair")
    parser.add_argument("--add-dasm", action="store_true", help="Add Data Acquisition and Survey Methods appointments")
    parser.add_argument("--verify-dasm", action="store_true", help="Verify Data Acquisition and Survey Methods appointments")
    parser.add_argument("--add-dic", action="store_true", help="Add Data-intensive Computing appointments")
    parser.add_argument("--verify-dic", action="store_true", help="Verify Data-intensive Computing appointments")
    parser.add_argument("--add-ils", action="store_true", help="Add Interdisciplinary Lecture Series on Data Science appointments")
    parser.add_argument("--verify-ils", action="store_true", help="Verify Interdisciplinary Lecture Series on Data Science appointments")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        if args.list_events:
            raise SystemExit(list_events(calendar_id=args.calendar_id, args=args))

        if args.create_event:
            raise SystemExit(create_event(calendar_id=args.calendar_id, args=args))

        if args.update_event:
            raise SystemExit(update_event(calendar_id=args.calendar_id, args=args))

        if args.delete_event:
            raise SystemExit(delete_event(calendar_id=args.calendar_id, args=args))

        if args.upsert_event:
            raise SystemExit(upsert_event(calendar_id=args.calendar_id, args=args))

        if args.verify_ils:
            raise SystemExit(
                verify_interdisciplinary_series_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.add_ils:
            raise SystemExit(
                add_interdisciplinary_series_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.verify_dic:
            raise SystemExit(
                verify_data_intensive_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.add_dic:
            raise SystemExit(
                add_data_intensive_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.verify_dasm:
            raise SystemExit(
                verify_data_acquisition_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.add_dasm:
            raise SystemExit(
                add_data_acquisition_course(
                    calendar_id=args.calendar_id,
                    tz_name=args.timezone,
                )
            )

        if args.repair:
            repair_schedule(
                course_name=args.course,
                calendar_id=args.calendar_id,
                tz_name=args.timezone,
            )
            if args.verify_after_repair:
                raise SystemExit(
                    verify_schedule(
                        course_name=args.course,
                        calendar_id=args.calendar_id,
                        tz_name=args.timezone,
                    )
                )
            raise SystemExit(0)

        raise SystemExit(
            verify_schedule(
                course_name=args.course,
                calendar_id=args.calendar_id,
                tz_name=args.timezone,
            )
        )
    except ValueError as exc:
        print(f"Error: {exc}")
        raise SystemExit(2)
