import SwiftUI

// MARK: - Projects view

struct ProjectsView: View {
    @EnvironmentObject var store: Store
    @State private var showNewProject = false

    private var active: [Project] { store.projects.filter { !$0.isCompleted } }
    private var completed: [Project] { store.projects.filter { $0.isCompleted } }

    var body: some View {
        NavigationStack {
            List {
                ForEach(active) { project in
                    NavigationLink(value: project.id) {
                        ProjectRow(project: project)
                    }
                }
                if !completed.isEmpty {
                    Section("Completed") {
                        ForEach(completed) { project in
                            NavigationLink(value: project.id) {
                                ProjectRow(project: project)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Projects")
            .navigationDestination(for: String.self) { projectId in
                if let project = store.projects.first(where: { $0.id == projectId }) {
                    ProjectDetailView(project: project)
                } else {
                    Text("Project gone").foregroundStyle(.secondary)
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewProject = true } label: { Label("New project", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showNewProject) {
                ProjectFormView(project: nil)
            }
        }
    }
}

struct ProjectRow: View {
    @EnvironmentObject var store: Store
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(project.name).strikethrough(project.isCompleted)
            HStack(spacing: 6) {
                Text("\(store.tasks(in: project).count) open")
                if let due = project.dueDate {
                    Text(DateRules.dueLabel(due))
                }
                if let minutes = project.durationMinutes {
                    Text(DateRules.formatDuration(minutes))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct ProjectDetailView: View {
    @EnvironmentObject var store: Store
    let project: Project
    @State private var editing = false
    @State private var addingTask = false

    var body: some View {
        let tasks = store.tasks(in: project)
        List {
            if let description = project.description, !description.isEmpty {
                Section {
                    Text(description).foregroundStyle(.secondary)
                }
            }
            if project.sectionsEnabled {
                let sections = Dictionary(grouping: tasks, by: { $0.section ?? "" })
                ForEach(sections.keys.sorted(), id: \.self) { section in
                    Section(section.isEmpty ? "No section" : section) {
                        ForEach(sections[section] ?? []) { task in
                            TaskRow(task: task)
                                .contextMenu { taskMenu(task) }
                        }
                    }
                }
            } else {
                Section("Tasks") {
                    ForEach(tasks) { task in
                        TaskRow(task: task)
                            .contextMenu { taskMenu(task) }
                    }
                }
            }
            if let notes = Optional(store.notes.filter { $0.projectId == project.id }), !notes.isEmpty {
                Section("Notes") {
                    ForEach(notes) { note in
                        Label(note.title, systemImage: "note.text")
                    }
                }
            }
        }
        .navigationTitle(project.name)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { addingTask = true } label: { Label("Add task", systemImage: "plus") }
                Menu {
                    Button(project.isCompleted ? "Reopen project" : "Mark completed") {
                        Task { await store.run("project.update", ["id": project.id, "isCompleted": !project.isCompleted]) }
                    }
                    Button(project.sectionsEnabled ? "Remove sections" : "Create sections") {
                        Task { await store.run("project.setSections", ["id": project.id, "enabled": !project.sectionsEnabled]) }
                    }
                    Button("Duplicate as new…") {
                        Task { await store.run("project.duplicate", ["id": project.id]) }
                    }
                    Button("Edit…") { editing = true }
                    Divider()
                    Button("Delete", role: .destructive) {
                        Task { await store.deleteEntity("project.delete", id: project.id) }
                    }
                } label: {
                    Label("Project actions", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $editing) { ProjectFormView(project: project) }
        .sheet(isPresented: $addingTask) {
            TaskFormView(task: nil, presetProjectId: project.id, presetCategory: store.categories.first?.name)
        }
    }

    @ViewBuilder
    private func taskMenu(_ task: RawTask) -> some View {
        Button(task.isCompleted ? "Mark not done" : "Mark done") {
            Task { await store.toggleTask(task) }
        }
        Button("Snooze to tomorrow") {
            Task { await store.run("task.snooze", ["id": task.id, "days": 1]) }
        }
        Divider()
        Button("Delete", role: .destructive) {
            Task { await store.deleteEntity("task.delete", id: task.id) }
        }
    }
}

// MARK: - Project form (add / edit)

struct ProjectFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    let project: Project?

    @State private var name = ""
    @State private var descriptionText = ""
    @State private var hasDue = false
    @State private var dueDate = Date()
    @State private var duration: Int? = nil
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                TextField("Description", text: $descriptionText, axis: .vertical)
                    .lineLimit(2...4)
                Toggle("Due date", isOn: $hasDue)
                if hasDue {
                    DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                }
                DurationField(minutes: $duration)
            }
            .formStyle(.grouped)
            .navigationTitle(project == nil ? "New project" : "Edit project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(project == nil ? "Add" : "Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .onAppear(perform: prefill)
        }
        .frame(minWidth: 420, minHeight: 300)
    }

    private func prefill() {
        guard let project else { return }
        name = project.name
        descriptionText = project.description ?? ""
        if let due = project.dueDate {
            hasDue = true
            dueDate = FormDates.pickerDate(from: due)
        }
        duration = project.durationMinutes
    }

    private func save() {
        var body: [String: Any] = [
            "name": name,
            "description": JSON.stringOrNull(descriptionText),
            "dueDate": hasDue ? FormDates.dayKey(dueDate) : JSON.null(),
            "durationMinutes": duration as Any? ?? JSON.null(),
        ]
        saving = true
        Task {
            let ok: Bool
            if let project {
                body["id"] = project.id
                ok = await store.run("project.update", body)
            } else {
                ok = await store.run("project.create", body)
            }
            saving = false
            if ok { dismiss() }
        }
    }
}
