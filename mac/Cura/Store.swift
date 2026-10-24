import Foundation
import SwiftUI

/// The app's single source of truth: the latest server snapshot plus the mutation helpers every
/// view calls. Unlike the web client there is no optimistic patching — mutations fire, then the
/// snapshot is re-pulled, so the UI always settles on server truth.
@MainActor
final class Store: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var isLoading = false
    @Published var errorMessage: String?

    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "cura.serverURL") }
    }
    @Published var nativeSecret: String {
        didSet { UserDefaults.standard.set(nativeSecret, forKey: "cura.nativeSecret") }
    }

    init() {
        serverURL = UserDefaults.standard.string(forKey: "cura.serverURL") ?? ""
        nativeSecret = UserDefaults.standard.string(forKey: "cura.nativeSecret") ?? ""
    }

    var isConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespaces).isEmpty && !nativeSecret.isEmpty
    }

    private var client: APIClient? {
        APIClient(serverURL: serverURL, secret: nativeSecret)
    }

    // MARK: - Sync

    func refresh() async {
        guard let client else {
            errorMessage = APIError.notConfigured.localizedDescription
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try await client.fetchSnapshot()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Runs a mutation and re-pulls the snapshot so every view settles on server truth.
    /// Returns true on success; on failure `errorMessage` is set instead.
    @discardableResult
    func run(_ action: String, _ fields: [String: Any] = [:]) async -> Bool {
        guard let client else {
            errorMessage = APIError.notConfigured.localizedDescription
            return false
        }
        do {
            _ = try await client.mutate(action, fields)
            await refresh()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Same as run, but hands back the mutation's result payload (e.g. note.saveBody's stored body).
    @discardableResult
    func runReturning(_ action: String, _ fields: [String: Any] = [:]) async -> Any? {
        guard let client else {
            errorMessage = APIError.notConfigured.localizedDescription
            return nil
        }
        do {
            let result = try await client.mutate(action, fields)
            await refresh()
            return result
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    // MARK: - Convenience accessors

    var timeZone: String { snapshot?.timeZone ?? "Asia/Shanghai" }
    var now: Date { Date() }

    var categories: [Category] { snapshot?.categories ?? [] }
    var projects: [Project] { snapshot?.projects ?? [] }
    var notes: [Note] { snapshot?.notes ?? [] }
    var habits: [Habit] { snapshot?.habits ?? [] }
    var routines: [Routine] { snapshot?.routines ?? [] }
    var countdowns: [Countdown] { snapshot?.countdowns ?? [] }

    var openTasks: [RawTask] {
        (snapshot?.tasks ?? []).filter { !$0.isCompleted }
    }

    var recentlyCompletedTasks: [RawTask] {
        (snapshot?.tasks ?? [])
            .filter { $0.isCompleted }
            .sorted { ($0.completedAt ?? $0.createdAt) > ($1.completedAt ?? $1.createdAt) }
    }

    /// Open tasks grouped into due buckets, in display order, each sorted like the web app
    /// (manual position first, then due time, then creation).
    var bucketedTasks: [(bucket: DateRules.DueBucket, tasks: [RawTask])] {
        var groups: [DateRules.DueBucket: [RawTask]] = [:]
        for task in openTasks {
            groups[DateRules.bucket(for: task.dueDate, now: now, timeZone: timeZone), default: []].append(task)
        }
        let order: [DateRules.DueBucket] = [.overdue, .today, .tomorrow, .week, .later, .none]
        return order.compactMap { bucket in
            guard let tasks = groups[bucket], !tasks.isEmpty else { return nil }
            return (bucket, tasks.sorted(by: taskOrder))
        }
    }

    func taskOrder(_ a: RawTask, _ b: RawTask) -> Bool {
        let ao = a.sortOrder ?? Double.greatestFiniteMagnitude
        let bo = b.sortOrder ?? Double.greatestFiniteMagnitude
        if ao != bo { return ao < bo }
        let ad = a.dueDate?.timeIntervalSince1970 ?? Double.greatestFiniteMagnitude
        let bd = b.dueDate?.timeIntervalSince1970 ?? Double.greatestFiniteMagnitude
        if ad != bd { return ad < bd }
        return a.createdAt < b.createdAt
    }

    func tasks(in project: Project) -> [RawTask] {
        openTasks.filter { $0.projectId == project.id }.sorted(by: taskOrder)
    }

    // MARK: - Common mutations

    func toggleTask(_ task: RawTask) async {
        // The server's toggleTaskCompletion expects the CURRENT state, not the desired one.
        await run("task.toggle", ["id": task.id, "isCompleted": task.isCompleted])
    }

    func toggleRoutine(_ routine: Routine) async {
        let ticked = DateRules.isTickedNow(routine, now: now, timeZone: timeZone)
        await run(ticked ? "routine.untick" : "routine.complete", ["id": routine.id])
    }

    func toggleHabitToday(_ habit: Habit) async {
        await run("habit.toggleCompletion", ["id": habit.id, "date": DateRules.dateKey(of: now, timeZone: timeZone)])
    }

    func deleteEntity(_ action: String, id: String) async {
        await run(action, ["id": id])
    }
}
