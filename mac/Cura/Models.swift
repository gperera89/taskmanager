import Foundation

// MARK: - Enums (mirror the Prisma schema)

enum RoutineFrequency: String, Codable, CaseIterable {
    case DAILY, WEEKLY, MONTHLY
}

enum RoutineMonthlyMode: String, Codable, CaseIterable {
    case DATE, WEEKDAY
}

enum HabitScheduleType: String, Codable, CaseIterable {
    case WEEKLY_DAYS, WEEKLY_COUNT, MONTHLY_COUNT
}

enum CategoryScope: String, Codable, CaseIterable {
    case WORK, HOME, NONE
}

// MARK: - Entities (the shapes getPageSnapshot returns)

struct RawTask: Codable, Identifiable {
    let id: String
    var title: String
    var description: String?
    var category: String
    var dueDate: Date?
    var isCompleted: Bool
    var completedAt: Date?
    var createdAt: Date
    var reminderLeadMinutes: Int?
    var durationMinutes: Int?
    var blockedReason: String?
    var blockedUntil: Date?
    var section: String?
    var sortOrder: Double?
    var repeatFrequency: RoutineFrequency?
    var repeatInterval: Int?
    var repeatDaysOfWeek: [Int]?
    var repeatMonthlyMode: RoutineMonthlyMode?
    var repeatDayOfMonth: Int?
    var repeatMonthlyOrdinal: Int?
    var repeatMonthlyWeekday: Int?
    var repeatUntil: Date?
    var pausedUntil: Date?
    var projectId: String?
    var parentId: String?
    var subtasks: [RawTask]?
}

struct Project: Codable, Identifiable {
    let id: String
    var name: String
    var description: String?
    var isCompleted: Bool
    var dueDate: Date?
    var reminderLeadMinutes: Int?
    var durationMinutes: Int?
    var sectionsEnabled: Bool
}

struct Note: Codable, Identifiable {
    let id: String
    var title: String
    var body: String
    var projectId: String?
    var taskId: String?
    var createdAt: Date
    var updatedAt: Date
}

struct Habit: Codable, Identifiable {
    let id: String
    var title: String
    var scheduleType: HabitScheduleType
    var targetCount: Int
    var daysOfWeek: [Int]
    var durationMinutes: Int?
    var pauseStart: Date?
    var pauseEnd: Date?
}

struct HabitCompletion: Codable, Identifiable {
    let id: String
    var habitId: String
    var date: Date
}

struct Routine: Codable, Identifiable {
    let id: String
    var title: String
    var reminderTime: String
    var frequency: RoutineFrequency
    var interval: Int
    var daysOfWeek: [Int]
    var monthlyMode: RoutineMonthlyMode
    var dayOfMonth: Int?
    var monthlyOrdinal: Int?
    var monthlyWeekday: Int?
    var durationMinutes: Int?
    var isActive: Bool
    var lastCompletedAt: Date?
    var pausedUntil: Date?
    var parentId: String?
    var subroutines: [Routine]?
}

struct Category: Codable, Identifiable {
    let id: String
    var name: String
    var scope: CategoryScope
}

struct Countdown: Codable, Identifiable {
    let id: String
    var title: String
    var date: Date
    var repeatsYearly: Bool
}

// MARK: - Snapshot (GET /api/native/snapshot)

struct Snapshot: Decodable {
    var tasks: [RawTask]
    var projects: [Project]
    var notes: [Note]
    var habits: [Habit]
    var habitCompletions: [HabitCompletion]
    var routines: [Routine]
    var categories: [Category]
    var countdowns: [Countdown]
    var timeZone: String
    var stateVersion: String
    var lastCronAt: Date?
}
