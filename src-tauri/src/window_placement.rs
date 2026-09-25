use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i64,
    y: i64,
    width: u32,
    height: u32,
}

impl Rect {
    fn right(self) -> i64 {
        self.x + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        self.y + i64::from(self.height)
    }

    fn overlap(self, other: Self) -> u64 {
        let width = (self.right().min(other.right()) - self.x.max(other.x)).max(0) as u64;
        let height = (self.bottom().min(other.bottom()) - self.y.max(other.y)).max(0) as u64;
        width * height
    }

    fn from_monitor(monitor: &tauri::Monitor) -> Self {
        let area = monitor.work_area();
        Self {
            x: i64::from(area.position.x),
            y: i64::from(area.position.y),
            width: area.size.width,
            height: area.size.height,
        }
    }
}

// All coordinates here are physical pixels, including negative coordinates on secondary displays.
fn corrected_placement(window: Rect, monitors: &[Rect], primary: Option<Rect>) -> Option<Rect> {
    let available: Vec<_> = monitors
        .iter()
        .copied()
        .filter(|area| area.width > 0 && area.height > 0)
        .collect();
    let target = available
        .iter()
        .copied()
        .max_by_key(|area| window.overlap(*area))
        .filter(|area| window.overlap(*area) > 0)
        .or_else(|| primary.filter(|area| area.width > 0 && area.height > 0))
        .or_else(|| available.first().copied())?;

    let width = window.width.clamp(1, target.width);
    let height = window.height.clamp(1, target.height);
    let x = window.x.clamp(target.x, target.right() - i64::from(width));
    let y = window
        .y
        .clamp(target.y, target.bottom() - i64::from(height));
    let result = Rect {
        x,
        y,
        width,
        height,
    };
    (result != window).then_some(result)
}

pub fn ensure_visible(window: &WebviewWindow) -> Result<(), String> {
    // Maximized windows have OS-specific border coordinates and are already placed by the OS.
    if window.is_maximized().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(Rect::from_monitor)
        .collect::<Vec<_>>();
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .as_ref()
        .map(Rect::from_monitor);
    let current = Rect {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: size.width,
        height: size.height,
    };
    if let Some(target) = corrected_placement(current, &monitors, primary) {
        if (target.width, target.height) != (current.width, current.height) {
            window
                .set_size(PhysicalSize::new(target.width, target.height))
                .map_err(|error| error.to_string())?;
        }
        if (target.x, target.y) != (current.x, current.y) {
            window
                .set_position(PhysicalPosition::new(
                    target.x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
                    target.y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
                ))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const SECONDARY: Rect = Rect {
        x: -2560,
        y: 0,
        width: 2560,
        height: 1400,
    };

    #[test]
    fn keeps_a_window_fully_inside_a_secondary_monitor() {
        let window = Rect {
            x: -2300,
            y: 90,
            width: 1440,
            height: 940,
        };
        assert_eq!(
            corrected_placement(window, &[PRIMARY, SECONDARY], Some(PRIMARY)),
            None
        );
    }

    #[test]
    fn moves_a_window_to_primary_when_its_monitor_disappears() {
        let window = Rect {
            x: -2300,
            y: 90,
            width: 1440,
            height: 940,
        };
        assert_eq!(
            corrected_placement(window, &[PRIMARY], Some(PRIMARY)),
            Some(Rect {
                x: 0,
                y: 90,
                ..window
            })
        );
    }

    #[test]
    fn clamps_a_window_after_resolution_or_work_area_shrinks() {
        let window = Rect {
            x: 1100,
            y: 580,
            width: 1440,
            height: 940,
        };
        assert_eq!(
            corrected_placement(window, &[PRIMARY], Some(PRIMARY)),
            Some(Rect {
                x: 480,
                y: 100,
                ..window
            })
        );
    }

    #[test]
    fn shrinks_an_oversized_window_to_the_available_work_area() {
        let window = Rect {
            x: -100,
            y: -100,
            width: 3000,
            height: 2000,
        };
        assert_eq!(
            corrected_placement(window, &[PRIMARY], Some(PRIMARY)),
            Some(PRIMARY)
        );
    }

    #[test]
    fn selects_the_monitor_with_the_largest_visible_area() {
        let window = Rect {
            x: -1000,
            y: 100,
            width: 1400,
            height: 900,
        };
        assert_eq!(
            corrected_placement(window, &[PRIMARY, SECONDARY], Some(PRIMARY)),
            Some(Rect { x: -1400, ..window })
        );
    }

    #[test]
    fn handles_unavailable_monitors_and_zero_sized_geometry() {
        let window = Rect {
            x: 100,
            y: 100,
            width: 0,
            height: 0,
        };
        assert_eq!(corrected_placement(window, &[], None), None);
        assert_eq!(
            corrected_placement(window, &[PRIMARY], Some(PRIMARY)),
            Some(Rect {
                width: 1,
                height: 1,
                ..window
            })
        );
    }
}
