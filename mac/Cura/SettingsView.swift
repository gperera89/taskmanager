import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @State private var testResult: String?

    var body: some View {
        Form {
            Section("Connection") {
                TextField("Server URL", text: $store.serverURL, prompt: Text("https://your-cura.vercel.app"))
                SecureField("Native secret", text: $store.nativeSecret)
                HStack {
                    Button("Test connection") {
                        Task {
                            await store.refresh()
                            testResult = store.errorMessage == nil
                                ? "Connected — state pulled at \(Date().formatted(date: .omitted, time: .shortened))."
                                : nil
                        }
                    }
                    if let testResult {
                        Text(testResult).foregroundStyle(.green)
                    }
                }
            }
            Section {
                Text("The secret must match NATIVE_API_SECRET (or SHORTCUT_SECRET) on the server. The timezone used for \"today\" comes from the server's own setting: \(store.timeZone).")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 460, height: 260)
    }
}
