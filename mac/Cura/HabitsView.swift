import SwiftUI

// MARK: - Habits view

struct HabitsView: View {
    @EnvironmentObject var store: Store
    @State private var sheet: HabitSheet?
    @State private var historyHabit: Habit?

    enum HabitSheet: Identifiable {
        case add
        case edit(Habit)
        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let h): return h.id
            }
        }
    }

    var body: some View {
        List {
            ForEach(store.habits) { habit in
                let keys = DateRules.completionKeys(for: habit.id, completions: store.snapshot?.habitCompletions ?? [])
                let status = DateRules.habitStatus(habit, completionKeys: keys, now: store.now, timeZone: store.timeZone)
                HabitRow(habit: habit, status: status)
                    .contentShape(Rectangle())
                    .onTapGesture { historyHabit = habit }
                    .contextMenu {
                        Button("History…") { historyHabit = habit }
                        Button("Edit…") { sheet = .edit(habit) }
                        Divider()
                        Button("Delete", role: .destructive) {
                            Task { await store.deleteEntity("habit.delete", id: habit.id) }
                        }
                    }
            }
        }
        .navigationTitle("Habits")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { sheet = .add } label: { Label("New habit", systemImage: "plus") }
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .add: HabitFormView(habit: nil)
            case .edit(let habit): HabitFormView(habit: habit)
            }
        }
        .sheet(item: $historyHabit) { habit in
            HabitHistoryView(habit: habit)
        }
    }
}

struct HabitRow: View {
    @EnvironmentObject var store: Store
    let habit: Habit
    let status: DateRules.HabitStatus

    private var flameColor: Color {
        switch DateRules.FlameState(status: status) {
        case .lit: return .orange
        case .flicker: return .yellow
        case .out: return .gray
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "flame.fill")
                .foregroundStyle(flameColor)
                .font(.title3)

            VStack(alignment: .leading, spacing: 3) {
                Text(habit.title)
                HStack(spacing: 6) {
                    Text("\(status.progressDone)/\(status.progressTarget) \(status.periodLabel)")
                    if status.streak > 0 {
                        Text("streak \(status.streak)")
                    }
                    if let minutes = habit.durationMinutes {
                        Text(DateRules.formatDuration(minutes))
                    }
                    if DateRules.habitPaused(on: DateRules.dateKey(of: store.now, timeZone: store.timeZone), habit: habit) {
                        Text("paused")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Button(status.isDoneToday ? "Done today" : "Mark done") {
                Task { await store.toggleHabitToday(habit) }
            }
            .buttonStyle(.bordered)
            .tint(status.isDoneToday ? .green : .accentColor)
            .controlSize(.small)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Habit history (tap-to-toggle heatmap, last 15 weeks)

struct HabitHistoryView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let habit: Habit

    private let weeks = 15

    var body: some View {
        let keys = DateRules.completionKeys(for: habit.id, completions: store.snapshot?.habitCompletions ?? [])
        let tz = store.timeZone
        let todayKey = DateRules.dateKey(of: store.now, timeZone: tz)
        // Anchor to the end of the current Monday-start week so columns are whole weeks.
        let faceNow = DateRules.fields(of: DateRules.zonedNow(store.now, timeZone: tz))
        let anchor = DateRules.utcMidnight(faceNow.year, faceNow.month0, faceNow.day)
        let fromMonday = (faceNow.weekday + 6) % 7
        let weekEnd = anchor.addingTimeInterval(TimeInterval(6 - fromMonday) * 86400)

        VStack(alignment: .leading, spacing: 12) {
            Text(habit.title).font(.headline)
            HStack(alignment: .top, spacing: 3) {
                ForEach(0..<weeks, id: \.self) { week in
                    VStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { day in
                            let date = weekEnd.addingTimeInterval(TimeInterval((week - (weeks - 1)) * 7 + day) * 86400)
                            let key = DateRules.anchorKey(date)
                            let done = keys.contains(key)
                            let future = key > todayKey
                            let paused = DateRules.habitPaused(on: key, habit: habit)
                            RoundedRectangle(cornerRadius: 2)
                                .fill(done ? Color.green : paused ? Color.blue.opacity(0.25) : Color.secondary.opacity(0.18))
                                .frame(width: 13, height: 13)
                                .opacity(future ? 0.25 : 1)
                                .onTapGesture {
                                    guard !future else { return }
                                    Task { await store.run("habit.toggleCompletion", ["id": habit.id, "date": key]) }
                                }
                                .help("\(key)\(done ? " — done" : "")\(paused ? " — paused" : "")")
                        }
                    }
                }
            }
            Text("Tap a square to toggle that day. Blue = planned break.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Close") { dismiss() }
            }
        }
        .padding()
    }
}

// MARK: - Habit form (add / edit)

struct HabitFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    let habit: Habit?

    @State private var title = ""
    @State private var scheduleType: HabitScheduleType = .WEEKLY_DAYS
    @State private var days: Set<Int> = []
    @State private var targetCount = 3
    @State private var duration: Int? = nil
    @State private var hasPause = false
    @State private var pauseStart = Date()
    @State private var pauseEnd = Date()
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                Picker("Schedule", selection: $scheduleType) {
                    Text("On days of the week").tag(HabitScheduleType.WEEKLY_DAYS)
                    Text("A number of times a week").tag(HabitScheduleType.WEEKLY_COUNT)
                    Text("A number of times a month").tag(HabitScheduleType.MONTHLY_COUNT)
                }
                if scheduleType == .WEEKLY_DAYS {
                    WeekdayPicker(days: $days)
                } else {
                    Stepper("\(targetCount) times per \(scheduleType == .WEEKLY_COUNT ? "week" : "month")",
                            value: $targetCount, in: 1...30)
                }
                DurationField(minutes: $duration)

                Section("Planned break") {
                    Toggle("Pause between dates", isOn: $hasPause)
                    if hasPause {
                        DatePicker("From", selection: $pauseStart, displayedComponents: .date)
                        DatePicker("To", selection: $pauseEnd, displayedComponents: .date)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(habit == nil ? "New habit" : "Edit habit")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(habit == nil ? "Add" : "Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty
                                  || (scheduleType == .WEEKLY_DAYS && days.isEmpty) || saving)
                }
            }
            .onAppear(perform: prefill)
        }
        .frame(minWidth: 440, minHeight: 420)
    }

    private func prefill() {
        guard let habit else { return }
        title = habit.title
        scheduleType = habit.scheduleType
        days = Set(habit.daysOfWeek)
        targetCount = habit.targetCount
        duration = habit.durationMinutes
        if let start = habit.pauseStart, let end = habit.pauseEnd {
            hasPause = true
            pauseStart = FormDates.pickerDate(from: start)
            pauseEnd = FormDates.pickerDate(from: end)
        }
    }

    private func save() {
        let body: [String: Any] = [
            "title": title,
            "scheduleType": scheduleType.rawValue,
            "targetCount": targetCount,
            "daysOfWeek": scheduleType == .WEEKLY_DAYS ? days.sorted() : [],
            "durationMinutes": duration as Any? ?? JSON.null(),
            "pauseStart": hasPause ? FormDates.dayKey(pauseStart) : JSON.null(),
            "pauseEnd": hasPause ? FormDates.dayKey(pauseEnd) : JSON.null(),
        ]
        saving = true
        Task {
            let ok: Bool
            if let habit {
                var edit = body
                edit["id"] = habit.id
                ok = await store.run("habit.update", edit)
            } else {
                ok = await store.run("habit.create", body)
            }
            saving = false
            if ok { dismiss() }
        }
    }
}
