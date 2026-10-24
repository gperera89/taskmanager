import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case tasks, projects, routines, habits, notes, countdowns

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tasks: return "Tasks"
        case .projects: return "Projects"
        case .routines: return "Routines"
        case .habits: return "Habits"
        case .notes: return "Notes"
        case .countdowns: return "Countdowns"
        }
    }

    var icon: String {
        switch self {
        case .tasks: return "checklist"
        case .projects: return "folder"
        case .routines: return "repeat"
        case .habits: return "flame"
        case .notes: return "note.text"
        case .countdowns: return "hourglass"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var store: Store
    @State private var selection: SidebarItem? = .tasks
    @State private var showError = false

    private let refreshTimer = Timer.publish(every: 120, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            if store.isConfigured {
                mainView
            } else {
                SetupView()
            }
        }
        .task {
            if store.isConfigured { await store.refresh() }
        }
        .onReceive(refreshTimer) { _ in
            if store.isConfigured { Task { await store.refresh() } }
        }
        .onChange(of: store.errorMessage) { _, message in
            showError = message != nil
        }
        .alert("Cura", isPresented: $showError) {
            Button("OK") { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    private var mainView: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $selection) { item in
                Label(item.title, systemImage: item.icon).tag(item)
            }
            .navigationTitle("Cura")
            .listStyle(.sidebar)
        } detail: {
            detail
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            Task { await store.refresh() }
                        } label: {
                            if store.isLoading {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                        }
                        .keyboardShortcut("r")
                        .help("Pull the latest state from the server")
                    }
                }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch selection ?? .tasks {
        case .tasks: TasksView()
        case .projects: ProjectsView()
        case .routines: RoutinesView()
        case .habits: HabitsView()
        case .notes: NotesView()
        case .countdowns: CountdownsView()
        }
    }
}

/// Shown until a server URL and secret are set.
struct SetupView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "link.badge.plus")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Connect to your Cura server")
                .font(.title2)
            Text("Enter the web app's URL and the native API secret. You can change both later in Settings (⌘,).")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
            Form {
                TextField("Server URL", text: $store.serverURL, prompt: Text("https://your-cura.vercel.app"))
                SecureField("Native secret", text: $store.nativeSecret)
            }
            .formStyle(.grouped)
            .frame(maxWidth: 420)
            Button("Connect") {
                Task { await store.refresh() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!store.isConfigured)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
