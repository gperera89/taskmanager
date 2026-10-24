import SwiftUI

// MARK: - Notes view (list + Markdown editor; checkbox lines sync to tasks server-side)

struct NotesView: View {
    @EnvironmentObject var store: Store
    @State private var selection: String?

    var body: some View {
        NavigationSplitView {
            List(store.notes.sorted { $0.updatedAt > $1.updatedAt }, selection: $selection) { note in
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.title)
                    Text(note.updatedAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .tag(note.id)
            }
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task {
                            let id = UUID().uuidString
                            if await store.run("note.create", ["id": id, "title": "Untitled"]) {
                                selection = id
                            }
                        }
                    } label: { Label("New note", systemImage: "plus") }
                }
            }
        } detail: {
            if let id = selection, let note = store.notes.first(where: { $0.id == id }) {
                NoteEditor(note: note)
            } else {
                Text("Pick a note, or start a new one.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct NoteEditor: View {
    @EnvironmentObject var store: Store
    let note: Note

    @State private var title: String = ""
    @State private var body_: String = ""
    @State private var dirty = false
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TextField("Title", text: $title)
                    .font(.title2)
                    .textFieldStyle(.plain)
                    .onChange(of: title) { _, _ in dirty = true }
                Spacer()
                if dirty { Text("Unsaved").font(.caption).foregroundStyle(.secondary) }
                Button(saving ? "Saving…" : "Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(!dirty || saving)
                    .keyboardShortcut("s", modifiers: .command)
                Menu {
                    Button("Delete note", role: .destructive) {
                        Task { await store.deleteEntity("note.delete", id: note.id) }
                    }
                } label: {
                    Label("Note actions", systemImage: "ellipsis.circle")
                }
            }
            .padding()

            Divider()

            TextEditor(text: $body_)
                .font(.body.monospaced())
                .scrollContentBackground(.hidden)
                .padding()
                .onChange(of: body_) { _, _ in dirty = true }
        }
        .onAppear(perform: load)
        .onChange(of: note.id) { _, _ in load() }
        .onDisappear {
            if dirty { save() }
        }
    }

    private func load() {
        title = note.title
        body_ = note.body
        dirty = false
    }

    private func save() {
        saving = true
        Task {
            if title != note.title {
                _ = await store.run("note.update", ["id": note.id, "title": title])
            }
            // The server returns the body as stored — checkbox lines get block ids assigned, and
            // a ticked repeating task's box comes back un-ticked when it rolled forward.
            if let stored = await store.runReturning("note.saveBody", ["id": note.id, "body": body_]) as? String {
                body_ = stored
            }
            saving = false
            dirty = false
        }
    }
}
