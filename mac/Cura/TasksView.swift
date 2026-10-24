import SwiftUI

// MARK: - Tasks view

struct TasksView: View {
    @EnvironmentObject var store: Store
    @State private var sheet: TaskSheet?
    @State private var showCompleted = false

    enum TaskSheet: Identifiable {
        case add
        case edit(RawTask)
        case subtask(RawTask)

        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let task): return "edit-\(task.id)"
            case .subtask(let task): return "sub-\(task.id)"
            }
        }
    }

    var body: some View {
        List {
            ForEach(store.bucketedTasks, id: \.bucket) { group in
                Section(group.bucket.rawValue) {
                    ForEach(group.tasks) { task in
                        TaskRow(task: task)
                            .contentShape(Rectangle())
                            .onTapGesture { sheet = .edit(task) }
                            .contextMenu { taskMenu(task) }
                    }
                }
            }
            if !store.recentlyCompletedTasks.isEmpty {
                Section {
                    DisclosureGroup(isExpanded: $showCompleted) {
                        ForEach(store.recentlyCompletedTasks) { task in
                            TaskRow(task: task)
                                .contextMenu { taskMenu(task) }
                        }
                    } label: {
                        Text("Recently completed")
                    }
                }
            }
        }
        .navigationTitle("Tasks")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { sheet = .add } label: { Label("New task", systemImage: "plus") }
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .add:
                TaskFormView(task: nil)
            case .edit(let task):
                TaskFormView(task: task)
            case .subtask(let parent):
                TaskFormView(task: nil, presetParentId: parent.id, presetProjectId: parent.projectId, presetCategory: parent.category)
            }
        }
    }

    @ViewBuilder
    private func taskMenu(_ task: RawTask) -> some View {
        Button(task.isCompleted ? "Mark not done" : "Mark done") {
            Task { await store.toggleTask(task) }
        }
        if !task.isCompleted {
            Button("Add subtask…") { sheet = .subtask(task) }
            Button("Snooze to tomorrow") {
                Task { await store.run("task.snooze", ["id": task.id, "days": 1]) }
            }
        }
        Divider()
        Button("Delete", role: .destructive) {
            Task { await store.deleteEntity("task.delete", id: task.id) }
        }
    }
}

struct TaskRow: View {
    @EnvironmentObject var store: Store
    let task: RawTask

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                Task { await store.toggleTask(task) }
            } label: {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.isCompleted ? Color.green : Color.secondary)
                    .font(.title3)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .strikethrough(task.isCompleted)
                    .foregroundStyle(task.isCompleted ? .secondary : .primary)
                HStack(spacing: 6) {
                    if let due = task.dueDate {
                        Text(DateRules.dueLabel(due))
                    }
                    Text(task.category)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(.quaternary, in: Capsule())
                    if task.repeatFrequency != nil {
                        Label(DateRules.describe(DateRules.RepeatRule(task: task)), systemImage: "repeat")
                    }
                    if let minutes = task.durationMinutes {
                        Text(DateRules.formatDuration(minutes))
                    }
                    if let reason = task.blockedReason, !reason.isEmpty {
                        Label("Waiting: \(reason)", systemImage: "pause.circle")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let subtasks = task.subtasks, !subtasks.isEmpty {
                    ForEach(subtasks) { sub in
                        SubtaskRow(subtask: sub)
                    }
                    .padding(.leading, 4)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct SubtaskRow: View {
    @EnvironmentObject var store: Store
    let subtask: RawTask

    var body: some View {
        HStack(spacing: 8) {
            Button {
                Task { await store.toggleTask(subtask) }
            } label: {
                Image(systemName: subtask.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(subtask.isCompleted ? Color.green : Color.secondary)
            }
            .buttonStyle(.plain)
            Text(subtask.title)
                .font(.callout)
                .strikethrough(subtask.isCompleted)
                .foregroundStyle(subtask.isCompleted ? .secondary : .primary)
            Spacer()
        }
        .contextMenu {
            Button("Delete", role: .destructive) {
                Task { await store.deleteEntity("task.delete", id: subtask.id) }
            }
        }
    }
}

// MARK: - Task form (add / edit)

struct TaskFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    let task: RawTask?
    var presetParentId: String?
    var presetProjectId: String?
    var presetCategory: String?

    enum RepeatKind: String, CaseIterable, Identifiable {
        case none, daily, weekly, monthly
        var id: String { rawValue }
        var title: String {
            switch self {
            case .none: return "Doesn't repeat"
            case .daily: return "Daily"
            case .weekly: return "Weekly"
            case .monthly: return "Monthly"
            }
        }
    }

    @State private var title = ""
    @State private var descriptionText = ""
    @State private var category = ""
    @State private var projectId = ""
    @State private var hasDue = false
    @State private var dueDate = Date()
    @State private var hasTime = false
    @State private var dueTime = Date()
    @State private var repeatKind: RepeatKind = .none
    @State private var repeatInterval = 1
    @State private var weeklyDays: Set<Int> = []
    @State private var monthlyMode: RoutineMonthlyMode = .DATE
    @State private var dayOfMonth = 1
    @State private var monthlyOrdinal = 1
    @State private var monthlyWeekday = 1
    @State private var hasRepeatUntil = false
    @State private var repeatUntil = Date()
    @State private var reminderLead: Int? = nil
    @State private var duration: Int? = nil
    @State private var blockedReason = ""
    @State private var hasBlockedUntil = false
    @State private var blockedUntil = Date()
    @State private var saving = false

    private static let leadOptions: [(Int?, String)] = [
        (nil, "At due time"), (10, "10 min before"), (30, "30 min before"),
        (60, "1 hour before"), (240, "4 hours before"), (1440, "1 day before"),
    ]

    init(task: RawTask?, presetParentId: String? = nil, presetProjectId: String? = nil, presetCategory: String? = nil) {
        self.task = task
        self.presetParentId = presetParentId
        self.presetProjectId = presetProjectId
        self.presetCategory = presetCategory
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                TextField("Notes", text: $descriptionText, axis: .vertical)
                    .lineLimit(2...4)

                Picker("Category", selection: $category) {
                    if !store.categories.contains(where: { $0.name == category }) {
                        Text(category.isEmpty ? "Pick one…" : category).tag(category)
                    }
                    ForEach(store.categories) { cat in
                        Text(cat.name).tag(cat.name)
                    }
                }

                Picker("Project", selection: $projectId) {
                    Text("None").tag("")
                    ForEach(store.projects.filter { !$0.isCompleted }) { project in
                        Text(project.name).tag(project.id)
                    }
                }

                Toggle("Due date", isOn: $hasDue)
                if hasDue {
                    DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                    Toggle("Time", isOn: $hasTime)
                    if hasTime {
                        DatePicker("Due at", selection: $dueTime, displayedComponents: .hourAndMinute)
                        Picker("Reminder", selection: $reminderLead) {
                            ForEach(Self.leadOptions, id: \.1) { option in
                                Text(option.1).tag(option.0)
                            }
                        }
                    }
                }

                Picker("Repeat", selection: $repeatKind) {
                    ForEach(RepeatKind.allCases) { Text($0.title).tag($0) }
                }
                if repeatKind != .none {
                    Stepper("Every \(repeatInterval) \(unitLabel)", value: $repeatInterval, in: 1...12)
                    if repeatKind == .weekly {
                        WeekdayPicker(days: $weeklyDays)
                    }
                    if repeatKind == .monthly {
                        Picker("Monthly mode", selection: $monthlyMode) {
                            Text("On a date").tag(RoutineMonthlyMode.DATE)
                            Text("On a weekday").tag(RoutineMonthlyMode.WEEKDAY)
                        }
                        if monthlyMode == .DATE {
                            Stepper("Day \(dayOfMonth == -1 ? "of month: last" : "\(dayOfMonth)")", value: $dayOfMonth, in: -1...31)
                            Text("Use -1 for the last day of the month.")
                                .font(.caption).foregroundStyle(.secondary)
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
                    Toggle("Ends", isOn: $hasRepeatUntil)
                    if hasRepeatUntil {
                        DatePicker("End date", selection: $repeatUntil, displayedComponents: .date)
                    }
                }

                DurationField(minutes: $duration)

                Section("Blocked (optional)") {
                    TextField("Waiting on…", text: $blockedReason)
                    Toggle("Until", isOn: $hasBlockedUntil)
                    if hasBlockedUntil {
                        DatePicker("Expected to clear", selection: $blockedUntil, displayedComponents: .date)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(task == nil ? "New task" : "Edit task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(task == nil ? "Add" : "Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || category.isEmpty || saving)
                }
            }
            .onAppear(perform: prefill)
        }
        .frame(minWidth: 480, minHeight: 560)
    }

    private var unitLabel: String {
        let unit: String
        switch repeatKind {
        case .daily: unit = "day"
        case .weekly: unit = "week"
        case .monthly: unit = "month"
        case .none: unit = ""
        }
        return repeatInterval == 1 ? unit : "\(unit)s"
    }

    private func prefill() {
        guard let task else {
            category = presetCategory ?? store.categories.first?.name ?? ""
            projectId = presetProjectId ?? ""
            return
        }
        title = task.title
        descriptionText = task.description ?? ""
        category = task.category
        projectId = task.projectId ?? ""
        if let due = task.dueDate {
            hasDue = true
            dueDate = FormDates.pickerDate(from: due)
            let f = DateRules.fields(of: due)
            if f.hour != 0 || f.minute != 0 {
                hasTime = true
                dueTime = FormDates.pickerTime(from: due)
            }
        }
        if let frequency = task.repeatFrequency {
            repeatKind = frequency == .DAILY ? .daily : frequency == .WEEKLY ? .weekly : .monthly
            repeatInterval = task.repeatInterval ?? 1
            weeklyDays = Set(task.repeatDaysOfWeek ?? [])
            monthlyMode = task.repeatMonthlyMode ?? .DATE
            dayOfMonth = task.repeatDayOfMonth ?? 1
            monthlyOrdinal = task.repeatMonthlyOrdinal ?? 1
            monthlyWeekday = task.repeatMonthlyWeekday ?? 1
            if let until = task.repeatUntil {
                hasRepeatUntil = true
                repeatUntil = FormDates.pickerDate(from: until)
            }
        }
        reminderLead = task.reminderLeadMinutes
        duration = task.durationMinutes
        blockedReason = task.blockedReason ?? ""
        if let until = task.blockedUntil {
            hasBlockedUntil = true
            blockedUntil = FormDates.pickerDate(from: until)
        }
    }

    private func repeatBody() -> Any {
        switch repeatKind {
        case .none:
            return JSON.null()
        case .daily:
            return ["frequency": "DAILY", "interval": repeatInterval] as [String: Any]
        case .weekly:
            return ["frequency": "WEEKLY", "interval": repeatInterval,
                    "daysOfWeek": weeklyDays.sorted()] as [String: Any]
        case .monthly:
            var body: [String: Any] = ["frequency": "MONTHLY", "interval": repeatInterval,
                                       "monthlyMode": monthlyMode.rawValue]
            if monthlyMode == .DATE {
                body["dayOfMonth"] = dayOfMonth
            } else {
                body["monthlyOrdinal"] = monthlyOrdinal
                body["monthlyWeekday"] = monthlyWeekday
            }
            if hasRepeatUntil { body["repeatUntil"] = FormDates.dayKey(repeatUntil) }
            return body
        }
    }

    private func save() {
        var body: [String: Any] = [
            "title": title,
            "category": category,
            "description": JSON.stringOrNull(descriptionText),
            "dueDate": hasDue ? FormDates.dayKey(dueDate) : JSON.null(),
            "dueTime": hasDue && hasTime ? FormDates.timeKey(dueTime) : JSON.null(),
            "projectId": projectId.isEmpty ? JSON.null() : projectId,
            "repeat": repeatBody(),
            "reminderLeadMinutes": reminderLead as Any? ?? JSON.null(),
            "durationMinutes": duration as Any? ?? JSON.null(),
            "blockedReason": JSON.stringOrNull(blockedReason),
            "blockedUntil": hasBlockedUntil ? FormDates.dayKey(blockedUntil) : JSON.null(),
        ]
        if let presetParentId { body["parentId"] = presetParentId }
        saving = true
        Task {
            let ok: Bool
            if let task {
                body["id"] = task.id
                ok = await store.run("task.update", body)
            } else {
                ok = await store.run("task.create", body)
            }
            saving = false
            if ok { dismiss() }
        }
    }
}
