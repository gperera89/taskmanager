import Foundation

// A faithful Swift port of the web app's scheduling rules:
//   client/src/lib/taskbookDates.ts  (face-value dates, buckets, timezone helpers)
//   client/src/lib/taskRecurrence.ts (repeat roll-forward, routine due-today math)
//   client/src/lib/shared.ts         (routine tick lifetime, habit status)
//
// The convention: stored dates are UTC-midnight of the chosen calendar date with a face-value
// clock time layered on top. All comparisons read a Date's UTC components as if they were local
// calendar fields. "now" is flattened into the app's configured timezone the same way
// zonedNow() does, so this app and the web app agree to the minute.

enum DateRules {

    // MARK: - Calendar plumbing

    static let utcCal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)!
        return c
    }()

    /// Calendar fields of a stored date, read in UTC (the face-value convention).
    /// `month0` is 0-based; `weekday` is JS-style (0 = Sunday ... 6 = Saturday).
    struct Fields {
        var year: Int
        var month0: Int
        var day: Int
        var weekday: Int
        var hour: Int
        var minute: Int
    }

    static func fields(of date: Date) -> Fields {
        let c = utcCal.dateComponents([.year, .month, .day, .weekday, .hour, .minute], from: date)
        return Fields(year: c.year ?? 0, month0: (c.month ?? 1) - 1, day: c.day ?? 1,
                      weekday: (c.weekday ?? 1) - 1, hour: c.hour ?? 0, minute: c.minute ?? 0)
    }

    static func utcMidnight(_ year: Int, _ month0: Int, _ day: Int) -> Date {
        utcCal.date(from: DateComponents(year: year, month: month0 + 1, day: day))!
    }

    static func utcDateTime(_ year: Int, _ month0: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        utcCal.date(from: DateComponents(year: year, month: month0 + 1, day: day, hour: hour, minute: minute))!
    }

    static func addDays(_ date: Date, _ days: Int) -> Date {
        utcCal.date(byAdding: .day, value: days, to: date)!
    }

    static func daysInMonth(_ year: Int, _ month0: Int) -> Int {
        // Day 0 of the following month = last day of this one.
        utcCal.date(from: DateComponents(year: year, month: month0 + 2, day: 0)).map { fields(of: $0).day } ?? 30
    }

    /// Same calendar day next month(s), clamped to the shortest month (Jan 31 + 1 month = Feb 28/29).
    static func addMonthsClamped(_ date: Date, _ months: Int, _ day: Int) -> Date {
        let f = fields(of: date)
        let totalIndex = f.year * 12 + f.month0 + months
        let year = totalIndex / 12
        let month0 = totalIndex % 12
        let clamped = min(day, daysInMonth(year, month0))
        return utcDateTime(year, month0, clamped, f.hour, f.minute)
    }

    // MARK: - Timezone flattening (zonedNow / zonedFaceMs)

    /// A Date whose UTC components read as the wall clock in `timeZone`.
    static func zonedNow(_ now: Date, timeZone: String) -> Date {
        let tz = TimeZone(identifier: timeZone) ?? .current
        return now.addingTimeInterval(TimeInterval(tz.secondsFromGMT(for: now)))
    }

    /// `YYYY-MM-DD` day-key for an instant, in the configured timezone.
    static func dateKey(of now: Date, timeZone: String) -> String {
        let f = fields(of: zonedNow(now, timeZone: timeZone))
        return String(format: "%04d-%02d-%02d", f.year, f.month0 + 1, f.day)
    }

    /// Day-key for a stored UTC-midnight calendar anchor.
    static func anchorKey(_ date: Date) -> String {
        let f = fields(of: date)
        return String(format: "%04d-%02d-%02d", f.year, f.month0 + 1, f.day)
    }

    /// Face-value milliseconds: the wall clock in `timeZone` flattened to UTC-midnight-plus-minutes.
    static func zonedFaceMs(_ now: Date, timeZone: String) -> TimeInterval {
        let f = fields(of: zonedNow(now, timeZone: timeZone))
        return utcMidnight(f.year, f.month0, f.day).timeIntervalSince1970 + TimeInterval((f.hour * 60 + f.minute) * 60)
    }

    // MARK: - Due-date buckets (bucketForDue)

    enum DueBucket: String {
        case overdue = "Overdue"
        case today = "Today"
        case tomorrow = "Tomorrow"
        case week = "This week"
        case later = "Later"
        case none = "No date"
    }

    static func daysUntil(due: Date, now: Date, timeZone: String) -> Int {
        let nf = fields(of: zonedNow(now, timeZone: timeZone))
        let df = fields(of: due)
        let a = utcMidnight(nf.year, nf.month0, nf.day).timeIntervalSince1970
        let b = utcMidnight(df.year, df.month0, df.day).timeIntervalSince1970
        return Int((b - a) / 86400)
    }

    static func bucket(for due: Date?, now: Date, timeZone: String) -> DueBucket {
        guard let due else { return .none }
        switch daysUntil(due: due, now: now, timeZone: timeZone) {
        case ..<0: return .overdue
        case 0: return .today
        case 1: return .tomorrow
        case 2...7: return .week
        default: return .later
        }
    }

    // MARK: - Formatting

    static let shortDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE d MMM"
        return f
    }()

    static let faceTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.timeStyle = .short
        return f
    }()

    /// Local-midnight Date for a stored due date's calendar day, safe for local formatters.
    static func localCalendarDate(of stored: Date) -> Date {
        let f = fields(of: stored)
        return Calendar.current.date(from: DateComponents(year: f.year, month: f.month0 + 1, day: f.day))!
    }

    /// "Sat 25 Oct" plus " · 6:00 PM" when a clock time was actually set (UTC midnight = no time).
    static func dueLabel(_ due: Date) -> String {
        let label = shortDateFormatter.string(from: localCalendarDate(of: due))
        let f = fields(of: due)
        if f.hour == 0 && f.minute == 0 { return label }
        return "\(label) · \(faceTimeFormatter.string(from: due))"
    }

    static func faceTimeLabel(_ date: Date) -> String {
        faceTimeFormatter.string(from: date)
    }

    // MARK: - Repeat / recurrence rules

    struct RepeatRule {
        var frequency: RoutineFrequency
        var interval: Int
        var daysOfWeek: [Int] // 0 = Sunday
        var monthlyMode: RoutineMonthlyMode
        var dayOfMonth: Int?
        var monthlyOrdinal: Int?
        var monthlyWeekday: Int?

        init(frequency: RoutineFrequency, interval: Int = 1, daysOfWeek: [Int] = [],
             monthlyMode: RoutineMonthlyMode = .DATE, dayOfMonth: Int? = nil,
             monthlyOrdinal: Int? = nil, monthlyWeekday: Int? = nil) {
            self.frequency = frequency
            self.interval = interval
            self.daysOfWeek = daysOfWeek
            self.monthlyMode = monthlyMode
            self.dayOfMonth = dayOfMonth
            self.monthlyOrdinal = monthlyOrdinal
            self.monthlyWeekday = monthlyWeekday
        }

        init(task: RawTask) {
            self.init(frequency: task.repeatFrequency ?? .DAILY,
                      interval: task.repeatInterval ?? 1,
                      daysOfWeek: task.repeatDaysOfWeek ?? [],
                      monthlyMode: task.repeatMonthlyMode ?? .DATE,
                      dayOfMonth: task.repeatDayOfMonth,
                      monthlyOrdinal: task.repeatMonthlyOrdinal,
                      monthlyWeekday: task.repeatMonthlyWeekday)
        }

        init(routine: Routine) {
            self.init(frequency: routine.frequency,
                      interval: routine.interval,
                      daysOfWeek: routine.daysOfWeek,
                      monthlyMode: routine.monthlyMode,
                      dayOfMonth: routine.dayOfMonth,
                      monthlyOrdinal: routine.monthlyOrdinal,
                      monthlyWeekday: routine.monthlyWeekday)
        }
    }

    /// The nth (or last, ordinal = -1) occurrence of `weekday` (0 = Sunday) in a month.
    static func nthWeekdayOfMonth(year: Int, month0: Int, weekday: Int, ordinal: Int, hour: Int, minute: Int) -> Date {
        if ordinal == -1 {
            let lastDay = daysInMonth(year, month0)
            for d in stride(from: lastDay, through: lastDay - 6, by: -1) {
                if fields(of: utcMidnight(year, month0, d)).weekday == weekday {
                    return utcDateTime(year, month0, d, hour, minute)
                }
            }
        }
        let firstWeekday = fields(of: utcMidnight(year, month0, 1)).weekday
        let firstMatch = 1 + ((weekday - firstWeekday + 7) % 7)
        let day = firstMatch + (ordinal - 1) * 7
        // "Fifth" in a four-of-that-weekday month falls back to the last occurrence.
        if day > daysInMonth(year, month0) {
            return nthWeekdayOfMonth(year: year, month0: month0, weekday: weekday, ordinal: -1, hour: hour, minute: minute)
        }
        return utcDateTime(year, month0, day, hour, minute)
    }

    /// Next occurrence of a repeating task's due date (nextOccurrence).
    static func nextOccurrence(of due: Date, rule: RepeatRule) -> Date {
        let interval = max(1, rule.interval)
        switch rule.frequency {
        case .DAILY:
            return addDays(due, interval)
        case .WEEKLY:
            if rule.daysOfWeek.isEmpty { return addDays(due, interval * 7) }
            let dow = fields(of: due).weekday
            let sorted = rule.daysOfWeek.sorted()
            if let next = sorted.first(where: { $0 > dow }) { return addDays(due, next - dow) }
            return addDays(due, 7 - dow + sorted[0] + (interval - 1) * 7)
        case .MONTHLY:
            if rule.monthlyMode == .WEEKDAY, let ordinal = rule.monthlyOrdinal, let weekday = rule.monthlyWeekday {
                let f = fields(of: due)
                let totalIndex = f.year * 12 + f.month0 + interval
                return nthWeekdayOfMonth(year: totalIndex / 12, month0: totalIndex % 12,
                                         weekday: weekday, ordinal: ordinal, hour: f.hour, minute: f.minute)
            }
            let day = rule.dayOfMonth == -1 ? 31 : (rule.dayOfMonth ?? fields(of: due).day)
            return addMonthsClamped(due, interval, day)
        }
    }

    static func nthWeekdayMatches(_ date: Date, weekday: Int, ordinal: Int) -> Bool {
        let f = fields(of: date)
        guard f.weekday == weekday else { return false }
        let daysLeft = daysInMonth(f.year, f.month0) - f.day
        if ordinal == -1 { return daysLeft < 7 }
        if Int(ceil(Double(f.day) / 7.0)) == ordinal { return true }
        return ordinal == 5 && daysLeft < 7
    }

    /// Whether a recurrence pattern lands on `at`'s calendar day (isRoutineDueToday).
    /// `at` is a zonedNow face-value Date. Interval is intentionally ignored, as in the web app.
    static func isDueToday(_ rule: RepeatRule, at: Date) -> Bool {
        switch rule.frequency {
        case .DAILY:
            return true
        case .WEEKLY:
            return rule.daysOfWeek.isEmpty || rule.daysOfWeek.contains(fields(of: at).weekday)
        case .MONTHLY:
            if rule.monthlyMode == .WEEKDAY, let ordinal = rule.monthlyOrdinal, let weekday = rule.monthlyWeekday {
                return nthWeekdayMatches(at, weekday: weekday, ordinal: ordinal)
            }
            let f = fields(of: at)
            if rule.dayOfMonth == -1 { return f.day == daysInMonth(f.year, f.month0) }
            return rule.dayOfMonth == f.day
        }
    }

    /// Next scheduled date strictly after `at`'s calendar day (nextRoutineOccurrence).
    static func nextRoutineOccurrence(_ rule: RepeatRule, at: Date, pausedUntil: Date?) -> Date {
        let f = fields(of: at)
        var candidate = utcMidnight(f.year, f.month0, f.day).addingTimeInterval(86400)
        if let paused = pausedUntil {
            let pf = fields(of: paused)
            let pausedDay = utcMidnight(pf.year, pf.month0, pf.day)
            if pausedDay > candidate { candidate = pausedDay }
        }
        for _ in 0..<400 {
            if isDueToday(rule, at: candidate) { return candidate }
            candidate = candidate.addingTimeInterval(86400)
        }
        return candidate
    }

    // MARK: - Routine tick lifetime (isRoutineTickedNow / routineDueAtMs)

    static func minutesOfDay(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return 0 }
        return h * 60 + m
    }

    /// When the tick expires: midnight at the start of the first scheduled date after the tick's
    /// calendar date, as a face-value ms anchor. nil = not ticked.
    static func tickReset(_ routine: Routine, timeZone: String) -> Date? {
        guard let last = routine.lastCompletedAt else { return nil }
        let tickedFace = zonedNow(last, timeZone: timeZone)
        return nextRoutineOccurrence(RepeatRule(routine: routine), at: tickedFace, pausedUntil: routine.pausedUntil)
    }

    static func isTickedNow(_ routine: Routine, now: Date, timeZone: String) -> Bool {
        guard let reset = tickReset(routine, timeZone: timeZone) else { return false }
        return zonedFaceMs(now, timeZone: timeZone) < reset.timeIntervalSince1970
    }

    /// The face-value instant the routine is currently waiting on (for "Next: …" labels).
    static func routineDueAt(_ routine: Routine, now: Date, timeZone: String) -> Date {
        let reminderOffset = TimeInterval(minutesOfDay(routine.reminderTime) * 60)
        if let reset = tickReset(routine, timeZone: timeZone),
           zonedFaceMs(now, timeZone: timeZone) < reset.timeIntervalSince1970 {
            return reset.addingTimeInterval(reminderOffset)
        }
        let faceNow = zonedNow(now, timeZone: timeZone)
        let f = fields(of: faceNow)
        let today = utcMidnight(f.year, f.month0, f.day)
        let pausedOut: Bool
        if let paused = routine.pausedUntil {
            let pf = fields(of: paused)
            pausedOut = today < utcMidnight(pf.year, pf.month0, pf.day)
        } else {
            pausedOut = false
        }
        let rule = RepeatRule(routine: routine)
        let base = (!pausedOut && isDueToday(rule, at: faceNow))
            ? today
            : nextRoutineOccurrence(rule, at: faceNow, pausedUntil: routine.pausedUntil)
        return base.addingTimeInterval(reminderOffset)
    }

    // MARK: - Schedule labels (describeTaskRepeat)

    static let weekdayAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static let ordinalWords: [Int: String] = [1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", -1: "Last"]

    static func intervalWord(_ n: Int, _ unit: String) -> String {
        n == 1 ? "Every \(unit)" : "Every \(n) \(unit)s"
    }

    static func describe(_ rule: RepeatRule) -> String {
        switch rule.frequency {
        case .DAILY:
            return intervalWord(rule.interval, "day")
        case .WEEKLY:
            let week = intervalWord(rule.interval, "week")
            let days = rule.daysOfWeek.sorted().map { weekdayAbbr[$0] }.joined(separator: ", ")
            return days.isEmpty ? week : "\(week) · \(days)"
        case .MONTHLY:
            let month = intervalWord(rule.interval, "month")
            if rule.monthlyMode == .WEEKDAY, let ordinal = rule.monthlyOrdinal, let weekday = rule.monthlyWeekday {
                return "\(month) · \(ordinalWords[ordinal] ?? "\(ordinal)") \(weekdayAbbr[weekday])"
            }
            if rule.dayOfMonth == -1 { return "\(month) · Last day" }
            if let day = rule.dayOfMonth { return "\(month) · \(day)\(daySuffix(day))" }
            return month
        }
    }

    static func daySuffix(_ n: Int) -> String {
        let s = ["th", "st", "nd", "rd"]
        let v = n % 100
        return ((v - 20) % 10 >= 0 && (v - 20) % 10 < s.count ? s[(v - 20) % 10] : nil)
            ?? (v < s.count ? s[v] : nil)
            ?? s[0]
    }

    // MARK: - Habit status (habitStatus)

    struct HabitStatus {
        var progressDone: Int
        var progressTarget: Int
        var periodLabel: String
        var streak: Int
        var isDoneToday: Bool
        var isPeriodMet: Bool
        var atRisk: Bool
        var lapsed: Bool
    }

    enum FlameState {
        case lit, flicker, out

        init(status: HabitStatus) {
            if status.lapsed { self = .out } else if status.atRisk { self = .flicker } else { self = .lit }
        }
    }

    private static func pauseBand(_ habit: Habit) -> (start: String, end: String)? {
        guard let a = habit.pauseStart, let b = habit.pauseEnd else { return nil }
        let ka = anchorKey(a), kb = anchorKey(b)
        return ka <= kb ? (ka, kb) : (kb, ka)
    }

    static func habitPaused(on dateKey: String, habit: Habit) -> Bool {
        guard let band = pauseBand(habit) else { return false }
        return dateKey >= band.start && dateKey <= band.end
    }

    /// Completion day-keys for one habit, in the configured timezone's calendar.
    static func completionKeys(for habitId: String, completions: [HabitCompletion]) -> Set<String> {
        Set(completions.filter { $0.habitId == habitId }.map { anchorKey($0.date) })
    }

    static func habitStatus(_ habit: Habit, completionKeys: Set<String>, now: Date, timeZone: String) -> HabitStatus {
        let todayKey = dateKey(of: now, timeZone: timeZone)
        let isDoneToday = completionKeys.contains(todayKey)
        let f = fields(of: zonedNow(now, timeZone: timeZone))
        let band = pauseBand(habit)
        let inBand: (String) -> Bool = { key in
            guard let band else { return false }
            return key >= band.start && key <= band.end
        }
        let todayPaused = inBand(todayKey)

        func monthPrefix(_ y: Int, _ m0: Int) -> String { String(format: "%04d-%02d-", y, m0 + 1) }
        func countInMonth(_ y: Int, _ m0: Int) -> Int { completionKeys.filter { $0.hasPrefix(monthPrefix(y, m0)) }.count }

        if habit.scheduleType == .MONTHLY_COUNT {
            let target = max(1, habit.targetCount)
            let done = countInMonth(f.year, f.month0)
            let daysLeft = daysInMonth(f.year, f.month0) - f.day
            let isPeriodMet = done >= target
            var streak = isPeriodMet ? 1 : 0
            var py = f.year, pm = f.month0
            for _ in 0..<240 {
                pm -= 1
                if pm < 0 { pm = 11; py -= 1 }
                let firstKey = String(format: "%04d-%02d-01", py, pm + 1)
                let lastKey = String(format: "%04d-%02d-%02d", py, pm + 1, daysInMonth(py, pm))
                if inBand(firstKey) && inBand(lastKey) { continue }
                if countInMonth(py, pm) >= target { streak += 1 } else { break }
            }
            return HabitStatus(progressDone: done, progressTarget: target, periodLabel: "this month",
                               streak: streak, isDoneToday: isDoneToday, isPeriodMet: isPeriodMet,
                               atRisk: !todayPaused && !isPeriodMet && target - done > daysLeft + 1,
                               lapsed: !todayPaused && !isPeriodMet && done == 0)
        }

        // Weekly modes key off the Monday-start week.
        let anchor = utcMidnight(f.year, f.month0, f.day)
        let fromMonday = (f.weekday + 6) % 7
        let weekStart = anchor.addingTimeInterval(TimeInterval(-fromMonday) * 86400)
        let weekEnd = anchor.addingTimeInterval(TimeInterval(6 - fromMonday) * 86400)
        let startKey = anchorKey(weekStart), endKey = anchorKey(weekEnd)
        let daysLeft = 6 - fromMonday
        let doneThisWeek = completionKeys.filter { $0 >= startKey && $0 <= endKey }.count

        if habit.scheduleType == .WEEKLY_DAYS {
            let scheduled = habit.daysOfWeek
            let target = max(1, scheduled.count)
            let todayScheduled = scheduled.contains(f.weekday)
            var streak = 0
            for i in 0..<800 {
                let cursor = anchor.addingTimeInterval(TimeInterval(-i) * 86400)
                let cf = fields(of: cursor)
                if !scheduled.contains(cf.weekday) { continue }
                let key = anchorKey(cursor)
                if inBand(key) { continue }
                if completionKeys.contains(key) { streak += 1 }
                else if key == todayKey { continue }
                else { break }
            }
            let isPeriodMet = doneThisWeek >= target
            return HabitStatus(progressDone: doneThisWeek, progressTarget: target, periodLabel: "this week",
                               streak: streak, isDoneToday: isDoneToday, isPeriodMet: isPeriodMet,
                               atRisk: todayScheduled && !isDoneToday && !todayPaused,
                               lapsed: streak == 0 && !isDoneToday && !todayPaused)
        }

        // WEEKLY_COUNT
        let target = max(1, habit.targetCount)
        let isPeriodMet = doneThisWeek >= target
        var streak = isPeriodMet ? 1 : 0
        var weekStartMs = weekStart
        for _ in 0..<400 {
            weekStartMs = weekStartMs.addingTimeInterval(-7 * 86400)
            let sKey = anchorKey(weekStartMs)
            let eKey = anchorKey(weekStartMs.addingTimeInterval(6 * 86400))
            if inBand(sKey) && inBand(eKey) { continue }
            if completionKeys.filter({ $0 >= sKey && $0 <= eKey }).count >= target { streak += 1 } else { break }
        }
        return HabitStatus(progressDone: doneThisWeek, progressTarget: target, periodLabel: "this week",
                           streak: streak, isDoneToday: isDoneToday, isPeriodMet: isPeriodMet,
                           atRisk: !todayPaused && !isPeriodMet && target - doneThisWeek > daysLeft + 1,
                           lapsed: !todayPaused && !isPeriodMet && doneThisWeek == 0 && streak == 0)
    }

    // MARK: - Countdowns

    /// Next occurrence of a countdown as a UTC-midnight anchor (nextCountdownOccurrenceMs).
    static func nextCountdownOccurrence(_ date: Date, repeatsYearly: Bool, now: Date, timeZone: String) -> Date {
        let f = fields(of: date)
        if !repeatsYearly { return utcMidnight(f.year, f.month0, f.day) }
        let nf = fields(of: zonedNow(now, timeZone: timeZone))
        let today = utcMidnight(nf.year, nf.month0, nf.day)
        let thisYear = utcMidnight(nf.year, f.month0, f.day)
        return thisYear >= today ? thisYear : utcMidnight(nf.year + 1, f.month0, f.day)
    }

    static func countdownLabel(_ countdown: Countdown, now: Date, timeZone: String) -> String {
        let occurrence = nextCountdownOccurrence(countdown.date, repeatsYearly: countdown.repeatsYearly, now: now, timeZone: timeZone)
        let nf = fields(of: zonedNow(now, timeZone: timeZone))
        let today = utcMidnight(nf.year, nf.month0, nf.day)
        let days = Int(occurrence.timeIntervalSince(today) / 86400)
        let dayText = days == 0 ? "Today" : days == 1 ? "Tomorrow" : "\(days) days"
        if countdown.repeatsYearly {
            let years = fields(of: occurrence).year - fields(of: countdown.date).year
            return years > 0 ? "\(dayText) · \(years) years" : dayText
        }
        return dayText
    }

    // MARK: - Duration parsing (parseDurationInput / formatDuration)

    static func parseDuration(_ raw: String) -> Int? {
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if s.isEmpty { return nil }
        if let n = Double(s), n > 0 { return Int(n.rounded()) }
        var total = 0.0
        var matched = false
        if let match = s.firstMatch(of: #/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/#), let h = Double(match.1) {
            total += h * 60; matched = true
        }
        if let match = s.firstMatch(of: #/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/#), let m = Double(match.1) {
            total += m; matched = true
        }
        guard matched else { return nil }
        let rounded = Int(total.rounded())
        return rounded > 0 ? rounded : nil
    }

    static func formatDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        let h = minutes / 60, m = minutes % 60
        if m == 0 { return h == 1 ? "1 hour" : "\(h) hours" }
        if m == 30 { return "\(h).5 hours" }
        return "\(h)h \(m)m"
    }
}
