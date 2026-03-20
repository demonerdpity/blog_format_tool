#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use blog_format_tool_lib::models::{AnalyzeRequest, ConfigEnvelope, ConvertRequest};
use blog_format_tool_lib::{config, converter};
use tauri::{
  image::Image,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_HIDE_ID: &str = "tray_hide";
const TRAY_QUIT_ID: &str = "tray_quit";

fn app_icon_image() -> Image<'static> {
  const SIZE: usize = 32;
  let mut rgba = vec![0u8; SIZE * SIZE * 4];

  fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
  }

  fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
  }

  fn coverage(signed_distance: f32) -> f32 {
    clamp01(0.5 - signed_distance)
  }

  fn distance_to_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let vx = bx - ax;
    let vy = by - ay;
    let wx = px - ax;
    let wy = py - ay;

    let c1 = wx * vx + wy * vy;
    if c1 <= 0.0 {
      return ((px - ax).powi(2) + (py - ay).powi(2)).sqrt();
    }

    let c2 = vx * vx + vy * vy;
    if c2 <= c1 {
      return ((px - bx).powi(2) + (py - by).powi(2)).sqrt();
    }

    let t = c1 / c2;
    let proj_x = ax + t * vx;
    let proj_y = ay + t * vy;
    ((px - proj_x).powi(2) + (py - proj_y).powi(2)).sqrt()
  }

  let size_f = SIZE as f32;
  let scale = size_f / 512.0;

  let rect_radius = 8.0f32;
  let half = size_f / 2.0;
  let inner_half = half - rect_radius;

  let stem_x = 212.0 * scale;
  let stem_y0 = 118.0 * scale;
  let stem_y1 = 412.0 * scale;
  let circle_cx = 328.0 * scale;
  let circle_cy = 312.0 * scale;
  let circle_r = 124.0 * scale;
  let stroke_radius = (88.0 * scale) / 2.0;

  let shine_cx = 0.18 * size_f;
  let shine_cy = 0.12 * size_f;
  let shine_r = 0.88 * size_f;

  for y in 0..SIZE {
    for x in 0..SIZE {
      let idx = (y * SIZE + x) * 4;

      let px = x as f32 + 0.5;
      let py = y as f32 + 0.5;

      let dx = (px - half).abs() - inner_half;
      let dy = (py - half).abs() - inner_half;
      let qx = dx.max(0.0);
      let qy = dy.max(0.0);
      let outside = (qx * qx + qy * qy).sqrt();
      let inside = dx.max(dy).min(0.0);
      let rect_sd = outside + inside - rect_radius;
      let rect_cov = coverage(rect_sd);

      if rect_cov <= 0.0 {
        rgba[idx..idx + 4].copy_from_slice(&[0, 0, 0, 0]);
        continue;
      }

      let gx = px / size_f;
      let gy = py / size_f;
      let t = ((gx + gy) * 0.5).clamp(0.0, 1.0);

      let (base_r, base_g, base_b) = if t < 0.55 {
        let f = t / 0.55;
        (
          lerp(14.0, 59.0, f),
          lerp(165.0, 130.0, f),
          lerp(233.0, 246.0, f),
        )
      } else {
        let f = (t - 0.55) / 0.45;
        (
          lerp(59.0, 139.0, f),
          lerp(130.0, 92.0, f),
          lerp(246.0, 246.0, f),
        )
      };

      let shine_d = (((px - shine_cx).powi(2) + (py - shine_cy).powi(2)).sqrt() / shine_r).clamp(0.0, 2.0);
      let shine_alpha = if shine_d <= 0.32 {
        lerp(0.42, 0.14, shine_d / 0.32)
      } else if shine_d <= 1.0 {
        lerp(0.14, 0.0, (shine_d - 0.32) / 0.68)
      } else {
        0.0
      };

      let bg_r = lerp(base_r, 255.0, shine_alpha);
      let bg_g = lerp(base_g, 255.0, shine_alpha);
      let bg_b = lerp(base_b, 255.0, shine_alpha);

      let stem_dist = distance_to_segment(px, py, stem_x, stem_y0, stem_x, stem_y1);
      let stem_cov = coverage(stem_dist - stroke_radius);

      let circle_dist = ((px - circle_cx).powi(2) + (py - circle_cy).powi(2)).sqrt();
      let circle_cov = coverage((circle_dist - circle_r).abs() - stroke_radius);

      let mark_cov = (stem_cov.max(circle_cov) * 0.98) * rect_cov;

      let out_r = lerp(bg_r, 255.0, mark_cov);
      let out_g = lerp(bg_g, 255.0, mark_cov);
      let out_b = lerp(bg_b, 255.0, mark_cov);

      rgba[idx] = out_r.round().clamp(0.0, 255.0) as u8;
      rgba[idx + 1] = out_g.round().clamp(0.0, 255.0) as u8;
      rgba[idx + 2] = out_b.round().clamp(0.0, 255.0) as u8;
      rgba[idx + 3] = (rect_cov * 255.0).round().clamp(0.0, 255.0) as u8;
    }
  }

  Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<ConfigEnvelope, String> {
  config::load_or_default(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: blog_format_tool_lib::models::AppConfig) -> Result<ConfigEnvelope, String> {
  config::save(&app, config).map_err(|e| e.to_string())
}

#[tauri::command]
fn analyze_markdown(request: AnalyzeRequest) -> Result<blog_format_tool_lib::models::AnalyzeResult, String> {
  converter::analyze_file(&request.md_path, &request.output_type, &request.config).map_err(|e| e.to_string())
}

#[tauri::command]
fn convert_markdown(request: ConvertRequest) -> Result<blog_format_tool_lib::models::ConvertReport, String> {
  converter::convert_file(&request.md_path, &request.output_type, &request.config, &request.meta)
    .map_err(|e| e.to_string())
}

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    if window.is_minimized()? {
      window.unminimize()?;
    }
    window.show()?;
    window.set_focus()?;
  }
  Ok(())
}

fn hide_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    window.hide()?;
  }
  Ok(())
}

fn toggle_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    if window.is_visible()? {
      hide_main_window(app)?;
    } else {
      show_main_window(app)?;
    }
  }
  Ok(())
}

fn register_main_window_behavior(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let app_handle = app.clone();
    window.on_window_event(move |event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = hide_main_window(&app_handle);
      }
    });
  }
}

fn build_tray(app: &tauri::AppHandle, icon: Image<'static>) -> tauri::Result<()> {
  let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
  let hide_item = MenuItem::with_id(app, TRAY_HIDE_ID, "隐藏到托盘", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出程序", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

  TrayIconBuilder::with_id("main-tray")
    .icon(icon)
    .tooltip("Blog Format Tool")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = toggle_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      register_main_window_behavior(app.handle());

      let icon = app_icon_image();
      if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_icon(icon.clone());
      }

      build_tray(app.handle(), icon)?;
      Ok(())
    })
    .on_menu_event(|app, event| match event.id().as_ref() {
      TRAY_SHOW_ID => {
        let _ = show_main_window(app);
      }
      TRAY_HIDE_ID => {
        let _ = hide_main_window(app);
      }
      TRAY_QUIT_ID => {
        app.exit(0);
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      load_config,
      save_config,
      analyze_markdown,
      convert_markdown
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
