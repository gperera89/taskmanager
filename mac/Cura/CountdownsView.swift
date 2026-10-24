import SwiftUI

// MARK: - Countdowns view

struct CountdownsView: View {
    @EnvironmentObject var store: Store
    @State private var sheet: CountdownSheet?

    enum CountdownSheet: Identifiable {
        case add
        case edit(Countdown)
        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let c): return c.id
            }
        }
    }

    var body: some View {
        List {
            ForEach(store.countdowns) { countdown in
                HStack {
                    Text(DateRules.countdownLabel(countdown, now: store.now, timeZone: store.timeZone))
                        .font(.headline)
                        .monospacedDigit()
                        .frame(minWidth: 120, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(countdown.title)
                        Text(DateRules.shortDateFormatter.string(from: DateRules.localCalendarDate(of: countdown.date))
                             + (countdown.repeatsYearly ? " · yearly" : " · one-off"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
                .contentShape(Rectangle())
                .onTapGesture { sheet = .edit(countdown) }
                .contextMenu {
                    Button("Edit…") { sheet = .edit(countdown) }
                    Divider()
                    Button("Delete", role: .destructive) {
                        Task { await store.deleteEntity("countdown.delete", id: countdown.id) }
                    }
                }
            }
        }
        .navigationTitle("Countdowns")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { sheet = .add } label: { Label("New countdown", systemImage: "plus") }
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .add: CountdownFormView(countdown: nil)
            case .edit(let countdown): CountdownFormView(countdown: countdown)
            }
        }
    }
}

struct CountdownFormView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    let countdown: Countdown?

    @State private var title = ""
    @State private var date = Date()
    @State private var repeatsYearly = true
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title, prompt: Text("e.g. Tracey's birthday"))
                DatePicker("Date", selection: $date, displayedComponents: .date)
                Toggle("Repeats yearly", isOn: $repeatsYearly)
                Text("Yearly countdowns keep the original year, so labels can read \"42 years\".")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
            .navigationTitle(countdown == nil ? "New countdown" : "Edit countdown")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(countdown == nil ? "Add" : "Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .onAppear(perform: prefill)
        }
        .frame(minWidth: 400, minHeight: 240)
    }

    private func prefill() {
        guard let countdown else { return }
        title = countdown.title
        date = FormDates.pickerDate(from: countdown.date)
        repeatsYearly = countdown.repeatsYearly
    }

    private func save() {
        var body: [String: Any] = [
            "title": title,
            "date": FormDates.dayKey(date),
            "repeatsYearly": repeatsYearly,
        ]
        saving = true
        Task {
            let ok: Bool
            if let countdown {
                body["id"] = countdown.id
                ok = await store.run("countdown.update", body)
            } else {
                ok = await store.run("countdown.create", body)
            }
            saving = false
            if ok { dismiss() }
        }
    }
}
