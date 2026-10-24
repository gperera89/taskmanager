import SwiftUI

/// The recurring weekly day toggles (Sun-Sat), shared by the task, routine and habit forms.
struct WeekdayPicker: View {
    @Binding var days: Set<Int>

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let selected = days.contains(day)
                Button(DateRules.weekdayAbbr[day]) {
                    if selected { days.remove(day) } else { days.insert(day) }
                }
                .buttonStyle(.bordered)
                .tint(selected ? .accentColor : .secondary)
                .controlSize(.small)
            }
        }
    }
}

/// Free-text duration box matching the web app's behaviour ("45 min", "1h 30m", bare minutes).
struct DurationField: View {
    @Binding var minutes: Int?
    @State private var text: String

    init(minutes: Binding<Int?>) {
        _minutes = minutes
        _text = State(initialValue: minutes.wrappedValue.map(DateRules.formatDuration) ?? "")
    }

    var body: some View {
        TextField("Duration", text: $text, prompt: Text("e.g. 45 min, 1.5 hours"))
            .onChange(of: text) { _, value in
                minutes = DateRules.parseDuration(value)
            }
    }
}

// MARK: - Date <-> string helpers for form fields (web semantics: local calendar date,
// face-value HH:mm)

enum FormDates {
    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    static func dayKey(_ date: Date) -> String { dayFormatter.string(from: date) }
    static func timeKey(_ date: Date) -> String { timeFormatter.string(from: date) }

    /// Prefill a date picker from a stored UTC-midnight date.
    static func pickerDate(from stored: Date) -> Date { DateRules.localCalendarDate(of: stored) }

    /// Prefill a time picker from a stored face-value time (its UTC hour/minute).
    static func pickerTime(from stored: Date) -> Date {
        let f = DateRules.fields(of: stored)
        return Calendar.current.date(bySettingHour: f.hour, minute: f.minute, second: 0, of: Date()) ?? Date()
    }
}

/// JSON body helpers: NSNull for explicit clears, omitted keys for "leave as-is".
enum JSON {
    static func null() -> NSNull { NSNull() }

    static func stringOrNull(_ text: String) -> Any {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? null() : trimmed
    }

    static func optionalString(_ text: String) -> Any? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
