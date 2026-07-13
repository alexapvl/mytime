import EventKit
import Foundation

private let eventStore = EKEventStore()
private struct HelperError: Error {
    let code: String
    let message: String
    let hint: String?

    init(_ code: String, _ message: String, hint: String? = nil) {
        self.code = code
        self.message = message
        self.hint = hint
    }
}

private func writeJSON(_ value: Any, exitCode: Int32 = 0) -> Never {
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    } catch {
        FileHandle.standardOutput.write(Data("{\"error\":{\"code\":\"encoding_failed\",\"message\":\"Could not encode helper response\"},\"ok\":false}\n".utf8))
    }
    Foundation.exit(exitCode)
}

private func succeed(_ data: Any) -> Never {
    writeJSON(["ok": true, "data": data])
}

private func fail(_ error: HelperError, exitCode: Int32 = 1) -> Never {
    var body: [String: Any] = ["code": error.code, "message": error.message]
    if let hint = error.hint { body["hint"] = hint }
    writeJSON(["ok": false, "error": body], exitCode: exitCode)
}

private func authorizationStatus() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .fullAccess: return "full_access"
    case .writeOnly: return "write_only"
    @unknown default: return "unknown"
    }
}

private func requireFullAccess() throws {
    guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
        throw HelperError(
            "calendar_access_required",
            "Full Calendar access is required",
            hint: "Run Apple Calendar setup and approve Full Access in System Settings > Privacy & Security > Calendars."
        )
    }
}

private func string(_ request: [String: Any], _ key: String, required: Bool = true) throws -> String? {
    if let value = request[key] as? String, !value.isEmpty { return value }
    if !required { return nil }
    throw HelperError("invalid_request", "\(key) must be a non-empty string")
}

private func bool(_ request: [String: Any], _ key: String, default defaultValue: Bool) throws -> Bool {
    guard let value = request[key] else { return defaultValue }
    guard let result = value as? Bool else {
        throw HelperError("invalid_request", "\(key) must be a boolean")
    }
    return result
}

private func strings(_ request: [String: Any], _ key: String, required: Bool = true) throws -> [String] {
    guard let value = request[key] else {
        if required { throw HelperError("invalid_request", "\(key) must be an array of strings") }
        return []
    }
    guard let result = value as? [String], result.allSatisfy({ !$0.isEmpty }) else {
        throw HelperError("invalid_request", "\(key) must be an array of non-empty strings")
    }
    return result
}

private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let fallbackISOFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

private let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = .autoupdatingCurrent
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .autoupdatingCurrent
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
}()

private func parseDate(_ value: String, key: String) throws -> Date {
    if let date = isoFormatter.date(from: value) ?? fallbackISOFormatter.date(from: value) ?? dayFormatter.date(from: value) {
        return date
    }
    throw HelperError("invalid_request", "\(key) must be an ISO 8601 datetime or yyyy-MM-dd date")
}

private func isDateOnly(_ value: String) -> Bool {
    value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
}

private func formatDate(_ date: Date, allDay: Bool) -> String {
    allDay ? dayFormatter.string(from: date) : isoFormatter.string(from: date)
}

private func sourceType(_ type: EKSourceType) -> String {
    switch type {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "caldav"
    case .mobileMe: return "icloud"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    @unknown default: return "unknown"
    }
}

private func calendarType(_ type: EKCalendarType) -> String {
    switch type {
    case .local: return "local"
    case .calDAV: return "caldav"
    case .exchange: return "exchange"
    case .subscription: return "subscription"
    case .birthday: return "birthday"
    @unknown default: return "unknown"
    }
}

private func calendarJSON(_ calendar: EKCalendar) -> [String: Any] {
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "type": calendarType(calendar.type),
        "sourceId": calendar.source.sourceIdentifier,
        "sourceTitle": calendar.source.title,
        "sourceType": sourceType(calendar.source.sourceType),
        "writable": calendar.allowsContentModifications,
        "subscribed": calendar.isSubscribed,
        "immutable": calendar.isImmutable,
    ]
}

private func eventStatus(_ status: EKEventStatus) -> String {
    switch status {
    case .none: return "none"
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "canceled"
    @unknown default: return "unknown"
    }
}

private func eventAvailability(_ availability: EKEventAvailability) -> String {
    switch availability {
    case .notSupported: return "not_supported"
    case .busy: return "busy"
    case .free: return "free"
    case .tentative: return "tentative"
    case .unavailable: return "unavailable"
    @unknown default: return "unknown"
    }
}

private struct MytimeIdentity {
    let itemId: String
    let itemType: String?
}

private func mytimeIdentity(from url: URL?) -> MytimeIdentity? {
    guard
        let url,
        url.scheme?.lowercased() == "mytime",
        url.host?.lowercased() == "item"
    else { return nil }
    let value = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard UUID(uuidString: value) != nil else { return nil }
    let type = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "type" })?.value
    let itemType = type == "task" || type == "event" ? type : nil
    return MytimeIdentity(itemId: value.lowercased(), itemType: itemType)
}

private func mytimeURL(itemId: String, itemType: String) throws -> URL {
    guard itemType == "task" || itemType == "event" else {
        throw HelperError("invalid_request", "mytimeItemType must be task or event")
    }
    guard let id = UUID(uuidString: itemId) else {
        throw HelperError("invalid_request", "mytimeItemId must be a UUID")
    }
    var components = URLComponents()
    components.scheme = "mytime"
    components.host = "item"
    components.path = "/\(id.uuidString.lowercased())"
    components.queryItems = [URLQueryItem(name: "type", value: itemType)]
    guard let url = components.url else {
        throw HelperError("invalid_request", "Could not create mytime item URL")
    }
    return url
}

private func reminderJSON(_ event: EKEvent) -> [[String: Any]] {
    let minutes = (event.alarms ?? []).compactMap { alarm -> Int? in
        let secondsBefore: TimeInterval
        if let absoluteDate = alarm.absoluteDate {
            secondsBefore = event.startDate.timeIntervalSince(absoluteDate)
        } else {
            secondsBefore = -alarm.relativeOffset
        }
        guard secondsBefore >= 0 else { return nil }
        return Int((secondsBefore / 60).rounded())
    }
    return Array(Set(minutes)).sorted(by: >).map { ["method": "popup", "minutes": $0] }
}

private func parseReminderMinutes(_ request: [String: Any]) throws -> [Int]? {
    guard request.keys.contains("reminders") else { return nil }
    guard let raw = request["reminders"] as? [[String: Any]] else {
        throw HelperError("invalid_request", "reminders must be an array of {method: popup, minutes: number}")
    }
    return try raw.map { reminder in
        guard reminder["method"] as? String == "popup" else {
            throw HelperError("invalid_request", "reminder method must be popup")
        }
        guard
            let number = reminder["minutes"] as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID(),
            number.doubleValue.rounded() == number.doubleValue,
            number.intValue >= 0
        else {
            throw HelperError("invalid_request", "reminder minutes must be a non-negative integer")
        }
        return number.intValue
    }
}

private func eventJSON(_ event: EKEvent) -> [String: Any] {
    let storedEnd = event.endDate!
    let outputEnd = event.isAllDay
        ? Calendar.autoupdatingCurrent.date(byAdding: .day, value: 1, to: storedEnd) ?? storedEnd
        : storedEnd
    var result: [String: Any] = [
        "calendarId": event.calendar.calendarIdentifier,
        "title": event.title ?? "",
        "start": formatDate(event.startDate, allDay: event.isAllDay),
        "end": formatDate(outputEnd, allDay: event.isAllDay),
        "allDay": event.isAllDay,
        "status": eventStatus(event.status),
        "availability": eventAvailability(event.availability),
        "hasRecurrenceRules": !(event.recurrenceRules?.isEmpty ?? true),
        "reminders": reminderJSON(event),
    ]
    if let id = event.eventIdentifier { result["id"] = id }
    if let externalId = event.calendarItemExternalIdentifier { result["externalId"] = externalId }
    if let notes = event.notes { result["notes"] = notes }
    if let location = event.location { result["location"] = location }
    if let identity = mytimeIdentity(from: event.url) {
        result["mytimeItemId"] = identity.itemId
        if let itemType = identity.itemType { result["mytimeItemType"] = itemType }
    } else if let url = event.url?.absoluteString {
        result["url"] = url
    }
    if let occurrenceDate = event.occurrenceDate {
        result["occurrenceStart"] = formatDate(occurrenceDate, allDay: event.isAllDay)
    }
    if event.isAllDay { result["endExclusive"] = true }
    if let lastModified = event.lastModifiedDate { result["lastModified"] = isoFormatter.string(from: lastModified) }
    return result
}

private func calendar(id: String) throws -> EKCalendar {
    guard let calendar = eventStore.calendar(withIdentifier: id) else {
        throw HelperError("calendar_not_found", "Calendar not found: \(id)")
    }
    return calendar
}

private func writableCalendar(id: String) throws -> EKCalendar {
    let result = try calendar(id: id)
    guard result.allowsContentModifications, !result.isImmutable else {
        throw HelperError("calendar_read_only", "Calendar is not writable: \(id)")
    }
    return result
}

private func sourceCanCreateCalendar(_ source: EKSource) -> Bool {
    switch source.sourceType {
    case .local, .exchange, .calDAV, .mobileMe: return true
    case .subscribed, .birthdays: return false
    @unknown default: return false
    }
}

private func writableCalendarCount(_ source: EKSource) -> Int {
    source.calendars(for: .event).filter { $0.allowsContentModifications && !$0.isImmutable }.count
}

private func sourceJSON(_ source: EKSource) -> [String: Any] {
    let writableCount = writableCalendarCount(source)
    return [
        "id": source.sourceIdentifier,
        "title": source.title,
        "type": sourceType(source.sourceType),
        "canCreateCalendar": sourceCanCreateCalendar(source),
        "writableCalendarCount": writableCount,
        "default": eventStore.defaultCalendarForNewEvents?.source.sourceIdentifier == source.sourceIdentifier,
    ]
}

private func handle(_ request: [String: Any]) throws -> Never {
    let command = try string(request, "command")!

    switch command {
    case "auth.status":
        succeed(["status": authorizationStatus()])

    case "auth.request":
        let current = authorizationStatus()
        if current == "full_access" { succeed(["status": current, "granted": true]) }
        eventStore.requestFullAccessToEvents { granted, error in
            if let error {
                fail(HelperError("authorization_failed", error.localizedDescription))
            }
            succeed(["status": authorizationStatus(), "granted": granted])
        }
        dispatchMain()

    case "calendar.list":
        try requireFullAccess()
        let calendars = eventStore.calendars(for: .event)
            .sorted { ($0.source.title, $0.title) < ($1.source.title, $1.title) }
            .map(calendarJSON)
        succeed(["calendars": calendars, "count": calendars.count])

    case "source.list":
        try requireFullAccess()
        let sources = Dictionary(grouping: eventStore.sources, by: \.sourceIdentifier)
            .compactMap { $0.value.first }
            .sorted { ($0.title, $0.sourceIdentifier) < ($1.title, $1.sourceIdentifier) }
            .map(sourceJSON)
        succeed(["sources": sources, "count": sources.count])

    case "calendar.create":
        try requireFullAccess()
        let title = try string(request, "title")!
        let sourceId = try string(request, "sourceId", required: false)
        let source: EKSource?
        if let sourceId {
            source = eventStore.sources.first { $0.sourceIdentifier == sourceId }
            if source == nil { throw HelperError("source_not_found", "Calendar source not found: \(sourceId)") }
        } else {
            let defaultSourceId = eventStore.defaultCalendarForNewEvents?.source.sourceIdentifier
            let candidates = Dictionary(
                grouping: eventStore.sources.filter {
                    sourceCanCreateCalendar($0)
                        && (writableCalendarCount($0) > 0 || $0.sourceIdentifier == defaultSourceId)
                },
                by: \.sourceIdentifier
            )
                .compactMap { $0.value.first }
            if candidates.count > 1 {
                throw HelperError(
                    "source_required",
                    "sourceId is required when multiple writable Calendar sources are available",
                    hint: "Run source.list and ask the user which Calendar account should contain the mytime calendar."
                )
            }
            source = candidates.first
        }
        guard let source else {
            throw HelperError("source_required", "No writable default Calendar source is configured")
        }
        if let existing = eventStore.calendars(for: .event).first(where: { $0.source.sourceIdentifier == source.sourceIdentifier && $0.title == title }) {
            guard existing.allowsContentModifications, !existing.isImmutable else {
                throw HelperError("calendar_read_only", "An existing calendar named \(title) is not writable")
            }
            succeed(["calendar": calendarJSON(existing), "created": false])
        }
        let newCalendar = EKCalendar(for: .event, eventStore: eventStore)
        newCalendar.title = title
        newCalendar.source = source
        do { try eventStore.saveCalendar(newCalendar, commit: true) }
        catch { throw HelperError("calendar_create_failed", error.localizedDescription) }
        succeed(["calendar": calendarJSON(newCalendar), "created": true])

    case "calendar.delete":
        try requireFullAccess()
        let calendarId = try string(request, "calendarId")!
        let confirmTitle = try string(request, "confirmTitle")!
        let target = try writableCalendar(id: calendarId)
        guard target.title == confirmTitle else {
            throw HelperError("confirmation_mismatch", "confirmTitle does not match the calendar title")
        }
        do { try eventStore.removeCalendar(target, commit: true) }
        catch { throw HelperError("calendar_delete_failed", error.localizedDescription) }
        succeed(["calendarId": calendarId, "deleted": true])

    case "calendar.rename":
        try requireFullAccess()
        let calendarId = try string(request, "calendarId")!
        let title = try string(request, "title")!
        let target = try writableCalendar(id: calendarId)
        target.title = title
        do { try eventStore.saveCalendar(target, commit: true) }
        catch { throw HelperError("calendar_rename_failed", error.localizedDescription) }
        succeed(["calendar": calendarJSON(target)])

    case "event.query":
        try requireFullAccess()
        let start = try parseDate(try string(request, "start")!, key: "start")
        let end = try parseDate(try string(request, "end")!, key: "end")
        guard end > start else { throw HelperError("invalid_request", "end must be after start") }
        let calendarIds = try strings(request, "calendarIds")
        let calendars = try calendarIds.map(calendar(id:))
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = eventStore.events(matching: predicate)
            .sorted { ($0.startDate, $0.title ?? "") < ($1.startDate, $1.title ?? "") }
            .map(eventJSON)
        succeed(["events": events, "count": events.count])

    case "event.upsert":
        try requireFullAccess()
        let calendarId = try string(request, "calendarId")!
        let targetCalendar = try writableCalendar(id: calendarId)
        let eventId = try string(request, "eventId", required: false)
        let event: EKEvent
        let created: Bool
        if let eventId {
            guard let existing = eventStore.event(withIdentifier: eventId) else {
                throw HelperError("event_not_found", "Event not found: \(eventId)")
            }
            guard existing.calendar.calendarIdentifier == calendarId else {
                throw HelperError("provider_scope_mismatch", "Event does not belong to calendar: \(calendarId)")
            }
            event = existing
            created = false
        } else {
            event = EKEvent(eventStore: eventStore)
            event.calendar = targetCalendar
            created = true
        }
        event.title = try string(request, "title")!
        let rawStart = try string(request, "start")!
        let rawEnd = try string(request, "end")!
        let allDay = try bool(request, "allDay", default: false)
        if allDay {
            guard isDateOnly(rawStart), isDateOnly(rawEnd) else {
                throw HelperError("invalid_request", "All-day start and end must use yyyy-MM-dd; end is exclusive")
            }
        }
        event.isAllDay = allDay
        event.startDate = try parseDate(rawStart, key: "start")
        let exclusiveEnd = try parseDate(rawEnd, key: "end")
        guard exclusiveEnd > event.startDate else { throw HelperError("invalid_request", "end must be after start") }
        event.endDate = allDay
            ? Calendar.autoupdatingCurrent.date(byAdding: .day, value: -1, to: exclusiveEnd) ?? exclusiveEnd
            : exclusiveEnd
        if request.keys.contains("notes") { event.notes = try string(request, "notes", required: false) }
        if request.keys.contains("location") { event.location = try string(request, "location", required: false) }
        if let reminderMinutes = try parseReminderMinutes(request) {
            event.alarms = reminderMinutes.map { EKAlarm(relativeOffset: -TimeInterval($0) * 60) }
        }
        let itemId = try string(request, "mytimeItemId", required: false)
        let itemType = try string(request, "mytimeItemType", required: false)
        if (itemId == nil) != (itemType == nil) {
            throw HelperError("invalid_request", "mytimeItemId and mytimeItemType must be provided together")
        }
        if request.keys.contains("url") {
            if let rawURL = try string(request, "url", required: false), let url = URL(string: rawURL), url.scheme != nil { event.url = url }
            else if request["url"] is NSNull || request["url"] as? String == "" {
                event.url = try itemId.map { try mytimeURL(itemId: $0, itemType: itemType!) }
            }
            else { throw HelperError("invalid_request", "url must be a valid URL string or null") }
        } else if let itemId, event.url == nil || mytimeIdentity(from: event.url) != nil {
            event.url = try mytimeURL(itemId: itemId, itemType: itemType!)
        }
        do { try eventStore.save(event, span: .thisEvent, commit: true) }
        catch { throw HelperError("event_save_failed", error.localizedDescription) }
        succeed(["event": eventJSON(event), "created": created])

    case "event.delete":
        try requireFullAccess()
        let eventId = try string(request, "eventId")!
        let calendarId = try string(request, "calendarId")!
        guard let event = eventStore.event(withIdentifier: eventId) else {
            succeed(["eventId": eventId, "deleted": false, "reason": "not_found"])
        }
        _ = try writableCalendar(id: calendarId)
        guard event.calendar.calendarIdentifier == calendarId else {
            throw HelperError("provider_scope_mismatch", "Event does not belong to calendar: \(calendarId)")
        }
        do { try eventStore.remove(event, span: .thisEvent, commit: true) }
        catch { throw HelperError("event_delete_failed", error.localizedDescription) }
        succeed(["eventId": eventId, "deleted": true])

    default:
        throw HelperError(
            "unknown_command",
            "Unknown command: \(command)",
            hint: "Valid commands: auth.status, auth.request, source.list, calendar.list, calendar.create, calendar.rename, calendar.delete, event.query, event.upsert, event.delete"
        )
    }
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard !input.isEmpty else { throw HelperError("invalid_request", "Expected one JSON request on stdin") }
    let value: Any
    do { value = try JSONSerialization.jsonObject(with: input) }
    catch { throw HelperError("invalid_json", "stdin must contain one valid JSON object") }
    guard let request = value as? [String: Any] else {
        throw HelperError("invalid_request", "stdin must contain one JSON object")
    }
    try handle(request)
} catch let error as HelperError {
    fail(error, exitCode: error.code == "invalid_request" || error.code == "invalid_json" || error.code == "unknown_command" ? 2 : 1)
} catch {
    fail(HelperError("internal_error", error.localizedDescription))
}
