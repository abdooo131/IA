// Shiply design tokens v1.0 for SwiftUI. Each color switches automatically between light and dark.
import SwiftUI
import UIKit

private func dyn(_ l: UInt32, _ d: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: d) : UIColor(hex: l) })
}
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
enum Shiply {
    static let blue = Color(UIColor(hex: 0x0047BB))
    static let sky = Color(UIColor(hex: 0x59CBE8))
    static let navy = Color(UIColor(hex: 0x13294B))
    static let bg = dyn(0xF3F6FA, 0x0B1424)
    static let surface = dyn(0xFFFFFF, 0x111E33)
    static let surfaceRaised = dyn(0xF3F6FA, 0x18273F)
    static let line = dyn(0xDFE5EE, 0x24344F)
    static let text = dyn(0x13294B, 0xE7EDF7)
    static let textMuted = dyn(0x5B6B82, 0x93A3BC)
    static let primary = dyn(0x0047BB, 0x2F6BFF)
    static let onPrimary = dyn(0xFFFFFF, 0xFFFFFF)
    static let primaryPressed = dyn(0x003C9D, 0x255BE0)
    static let link = dyn(0x0047BB, 0x5B8CFF)
    static let selectedBg = dyn(0xE6F6FB, 0x18273F)
    static let sky = dyn(0x59CBE8, 0x59CBE8)
    static let focus = dyn(0x59CBE8, 0x59CBE8)
    static let danger = dyn(0xDC2626, 0xF87171)
    static let statusNew = dyn(0x64748B, 0x94A3B8)
    static let statusInProgress = dyn(0x7C3AED, 0xA78BFA)
    static let statusHeadingToCustomer = dyn(0xC026D3, 0xE879F9)
    static let statusDelivered = dyn(0x16A34A, 0x4ADE80)
    static let statusNeedsAction = dyn(0xD97706, 0xFB923C)
    static let statusReturning = dyn(0xDC2626, 0xF87171)
    static let cash = dyn(0x0E9384, 0x2DD4BF)
    static let points = dyn(0xFFC21A, 0xFFD34D)
}
