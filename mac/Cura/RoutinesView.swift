import SwiftUI

// MARK: - Routines view

struct RoutinesView: View {
    @EnvironmentObject var store: Store
    @State private var sheet: RoutineSheet?
    @State private var subParent: Routine?

    enum RoutineSheet: Identifiable {
        case add
        case edit(Routine)
        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let r): return r.id
            }
        }
    }

    private struct Groups {
        var dueNow: [Routine] = []
        var ticked: [Routine] = []
        var later: [Routine] = []
    }

    private var groups: Groups {
        var result = Groups()
        let now = store.now, tz = store.timeZone
        for routine in store.routines {
            let ticked = DateRules.isTickedNow(routine, now: now, timeZone: tz)
            let dueAt = DateRules.routineDueAt(routine, now: now, timeZone: tz)
            let faceNow = DateRules.zonedFaceMs(now, timeZone: tz)
            if ticked {
                result.ticked.append(routine)
            } else if dueAt.timeIntervalSince1970 - faceNow <= 16 * 3600 {
                result.dueNow.append(routine)
            } else {
                result.later.append(routine)
            }
        }
        return result
    }

    var body: some View {
        List {
            if !groups.dueNow.isEmpty {
                Section("Due") {
                    ForEach(groups.dueNow) { routineRow($0, ticked: false) }
                }
            }
            if !groups.ticked.isEmpty {
                Section("Done for now") {
                    ForEach(groups.ticked) { routineRow($0, ticked: true) }
                }
            }
            if !groups.later.isEmpty {
                Section("Later") {
                    ForEach(groups.later) { routineRow($0, ticked: false) }
                }
            }
        }
        .navigationTitle("Routines")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { sheet = .add } label: { Label("New routine", systemImage: "plus") }
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .add: RoutineFormView(routine: nil)
            case .edit(let routine): RoutineFormView(routine: routine)
            }
        }
        .sheet(item: $subParent) { parent in
            SubroutineFormView(parent: parent)
        }
    }

    private func routineRow(_ routine: Routine, ticked: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                Task { await store.toggleRoutine(routine) }
            } label: {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(ticked ? Color.green : Color.secondary)
                    .font(.title3)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(routine.title).strikethrough(ticked)
                    if !routine.isActive {
                        Text("inactive")
                            .font(.caption)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(.quaternary, in: Capsule())
                    }
                }
                HStack(spacing: 6) {
                    Text(routine.reminderTime)
                    Text(DateRules.describe(DateRules.RepeatRule(routine: routine)))
                    let dueAt = DateRules.routineDueAt(routine, now: store.now, timeZone: store.timeZone)
                    Text("Next: \(DateRules.dueLabel(dueAt))")
                    if let minutes = routine.durationMinutes {
                        Text(DateRules.formatDuration(minutes))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let subs = routine.subroutines, !subs.isEmpty {
                    ForEach(subs) { sub in
                        HStack(spacing: 6) {
                            Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                            Text(sub.title).font(.callout).foregroundStyle(.secondary)
                            Spacer()
                        }
                        .contextMenu {
                            Button("Delete", role: .destructive) {
                                Task { await store.deleteEntity("routine.delete", id: sub.id) }
                            }
                        }
                    }
                    .padding(.leading, 4)
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .contextMenu {
            Button(ticked ? "Untick" : "Tick done") {
                Task { await store.toggleRoutine(routine) }
            }
            Button("Add sub-routine…") { subParent = routine }
            Button("Edit…") { sheet = .edit(routine) }
            Divider()
            Button("Delete", role: .destructive) {
                Task { await store.deleteEntity("routine.delete", id: routine.id) }
            }
        }
    }
}

struct SubroutineFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let parent: Routine
    @State private var title = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Sub-routine title", text: $title)
                Text("Added to \"\(parent.title)\" — it ticks and notifies with the cluster.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
            .navigationTitle("New sub-routine")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            if await store.run("routine.createSubroutine", ["parentId": parent.id, "title": title]) {
                                dismiss()
                            }
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 380, minHeight: 160)
    }
}

// MARK: - Routine form (add / edit)

struct RoutineFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    let routine: Routine?

    @State private var title = ""
    @State private var reminderTime = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var frequency: RoutineFrequency = .DAILY
    @State private var interval = 1
    @State private var weeklyDays: Set<Int> = []
    @State private var monthlyMode: RoutineMonthlyMode = .DATE
    @State private var dayOfMonth = 1
    @State private var monthlyOrdinal = 1
    @State private var monthlyWeekday = 1
    @State private var isActive = true
    @State private var hasPausedUntil = false
    @State private var pausedUntil = Date()
    @State private var duration: Int? = nil
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                DatePicker("Reminder time", selection: $reminderTime, displayedComponents: .hourAndMinute)

                Picker("Frequency", selection: $frequency) {
                    Text("Daily").tag(RoutineFrequency.DAILY)
                    Text("Weekly").tag(RoutineFrequency.WEEKLY)
                    Text("Monthly").tag(RoutineFrequency.MONTHLY)
                }
                if frequency != .DAILY {
                    Stepper("Every \(interval) \(frequency == .WEEKLY ? (interval == 1 ? "week" : "weeks") : (interval == 1 ? "month" : "months"))",
                            value: $interval, in: 1...12)
                }
                if frequency == .WEEKLY {
                    WeekdayPicker(days: $weeklyDays)
                }
                if frequency == .MONTHLY {
                    Picker("Monthly mode", selection: $monthlyMode) {
                        Text("On a date").tag(RoutineMonthlyMode.DATE)
                        Text("On a weekday").tag(RoutineMonthlyMode.WEEKDAY)
                    }
                    if monthlyMode == .DATE {
                        Stepper(dayOfMonth == -1 ? "Last day of the month" : "Day \(dayOfMonth) of the month",
                                value: $dayOfMonth, in: -1...31)
                    } else {
                        Picker("Occurrence", selection: $monthlyOrdinal) {
                            ForEach([1, 2, 3, 4, 5, -1], id: \.self) { ordinal in
                                Text(DateRules.ordinalWords[ordinal] ?? "\(ordinal)").tag(ordinal)
                            }
                        }
                        Picker("Weekday", selection: $monthlyWeekday) {
                            ForEach(0..<7, id: \.self) { day in
                                Text(DateRules.weekdayAbbr[day]).tag(day)
                            }
                        }
                    }
                }

                DurationField(minutes: $duration)
                Toggle("Active", isOn: $isActive)
                Toggle("Paused until", isOn: $hasPausedUntil)
                if hasPausedUntil {
                    DatePicker("Resume on", selection: $pausedUntil, displayedComponents: .date)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(routine == nil ? "New routine" : "Edit routine")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(routine == nil ? "Add" : "Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .onAppear(perform: prefill)
        }
        .frame(minWidth: 460, minHeight: 480)
    }

    private func prefill() {
        guard let routine else { return }
        title = routine.title
        let minutes = DateRules.minutesOfDay(routine.reminderTime)
        reminderTime = Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date()
        frequency = routine.frequency
        interval = routine.interval
        weeklyDays = Set(routine.daysOfWeek)
        monthlyMode = routine.monthlyMode
        dayOfMonth = routine.dayOfMonth ?? 1
        monthlyOrdinal = routine.monthlyOrdinal ?? 1
        monthlyWeekday = routine.monthlyWeekday ?? 1
        isActive = routine.isActive
        if let paused = routine.pausedUntil {
            hasPausedUntil = true
            pausedUntil = FormDates.pickerDate(from: paused)
        }
        duration = routine.durationMinutes
    }

    private func save() {
        var body: [String: Any] = [
            "title": title,
            "reminderTime": FormDates.timeKey(reminderTime),
            "frequency": frequency.rawValue,
            "interval": interval,
            "daysOfWeek": frequency == .WEEKLY ? weeklyDays.sorted() : [],
            "monthlyMode": monthlyMode.rawValue,
            "durationMinutes": duration as Any? ?? JSON.null(),
            "isActive": isActive,
            "pausedUntil": hasPausedUntil ? FormDates.dayKey(pausedUntil) : JSON.null(),
        ]
        if frequency == .MONTHLY {
            if monthlyMode == .DATE {
                body["dayOfMonth"] = dayOfMonth
            } else {
                body["monthlyOrdinal"] = monthlyOrdinal
                body["monthlyWeekday"] = monthlyWeekday
            }
        }
        saving = true
        Task {
            let ok: Bool
            if let routine {
                body["id"] = routine.id
                ok = await store.run("routine.update", body)
            } else {
                ok = await store.run("routine.create", body)
            }
            saving = false
            if ok { dismiss() }
        }
    }
}
