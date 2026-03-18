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

fn tray_icon_image() -> Image<'static> {
  let size = 32usize;
  let mut rgba = vec![0u8; size * size * 4];
  let radius = 7.0f32;

  let inside_rounded_rect = |x: usize, y: usize| {
    let left = 3.0f32;
    let top = 3.0f32;
    let right = (size as f32) - 4.0;
    let bottom = (size as f32) - 4.0;
    let px = x as f32 + 0.5;
    let py = y as f32 + 0.5;

    let closest_x = px.clamp(left + radius, right - radius);
    let closest_y = py.clamp(top + radius, bottom - radius);
    let dx = px - closest_x;
    let dy = py - closest_y;
    dx * dx + dy * dy <= radius * radius
  };

  for y in 0..size {
    for x in 0..size {
      let idx = (y * size + x) * 4;
      if !inside_rounded_rect(x, y) {
        rgba[idx..idx + 4].copy_from_slice(&[0, 0, 0, 0]);
        continue;
      }

      let mix = ((x as f32 / (size - 1) as f32) * 0.6) + ((1.0 - y as f32 / (size - 1) as f32) * 0.4);
      let mix = mix.clamp(0.0, 1.0);
      let red = (15.0 + (24.0 - 15.0) * mix) as u8;
      let green = (110.0 + (160.0 - 110.0) * mix) as u8;
      let blue = (248.0 + (182.0 - 248.0) * mix) as u8;

      let in_ribbon = ((9..=13).contains(&y) && (9..=22).contains(&x))
        || ((15..=19).contains(&y) && (11..=20).contains(&x))
        || ((21..=24).contains(&y) && (13..=18).contains(&x));

      let pixel = if in_ribbon {
        [245, 250, 255, 255]
      } else {
        [red, green, blue, 255]
      };

      rgba[idx..idx + 4].copy_from_slice(&pixel);
    }
  }

  Image::new_owned(rgba, size as u32, size as u32)
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

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
  let hide_item = MenuItem::with_id(app, TRAY_HIDE_ID, "隐藏到托盘", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出程序", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

  TrayIconBuilder::with_id("main-tray")
    .icon(tray_icon_image())
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
      build_tray(app.handle())?;
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
