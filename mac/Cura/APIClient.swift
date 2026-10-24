import Foundation

enum APIError: LocalizedError {
    case notConfigured
    case badURL
    case server(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Set the server URL and secret in Settings first."
        case .badURL: return "The server URL doesn't look right."
        case .server(let message): return message
        case .decoding(let message): return "Couldn't read the server response: \(message)"
        }
    }
}

struct APIClient {
    let baseURL: URL
    let secret: String

    init?(serverURL: String, secret: String) {
        var trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard !trimmed.isEmpty, !secret.isEmpty, let url = URL(string: trimmed) else { return nil }
        self.baseURL = url
        self.secret = secret
    }

    private func makeRequest(path: String, method: String, body: [String: Any]? = nil) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue(secret, forHTTPHeaderField: "x-native-secret")
        request.timeoutInterval = 30
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = iso8601.date(from: string) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date: \(string)")
        }
        return d
    }()

    func fetchSnapshot() async throws -> Snapshot {
        let request = try makeRequest(path: "api/native/snapshot", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response, data: data)
        do {
            return try Self.decoder.decode(Snapshot.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    /// Fires one mutation action at /api/native/mutate. Returns the raw `result` value, if any.
    @discardableResult
    func mutate(_ action: String, _ fields: [String: Any] = [:]) async throws -> Any? {
        var body = fields
        body["action"] = action
        let request = try makeRequest(path: "api/native/mutate", method: "POST", body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response, data: data)
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let error = json?["error"] as? String { throw APIError.server(error) }
        return json?["result"]
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if (200..<300).contains(http.statusCode) { return }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let message = json?["error"] as? String ?? "HTTP \(http.statusCode)"
        throw APIError.server(http.statusCode == 401 ? "Not authenticated — check the secret in Settings." : message)
    }
}
