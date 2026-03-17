use std::path::{Component, Path, PathBuf};

pub fn resolve_under_repo(repo_root: &Path, maybe_rel: &str) -> PathBuf {
  let p = PathBuf::from(maybe_rel);
  if p.is_absolute() {
    p
  } else {
    repo_root.join(p)
  }
}

pub fn is_remote_url(s: &str) -> bool {
  let s = s.trim().to_ascii_lowercase();
  s.starts_with("http://") || s.starts_with("https://")
}

pub fn is_site_images_path(s: &str) -> bool {
  let s = s.trim();
  s.starts_with("/images/")
}

pub fn relative_markdown_path(from_dir: &Path, to_path: &Path) -> String {
  let from_components: Vec<Component<'_>> = from_dir.components().collect();
  let to_components: Vec<Component<'_>> = to_path.components().collect();

  let mut common_len = 0usize;
  while common_len < from_components.len()
    && common_len < to_components.len()
    && from_components[common_len] == to_components[common_len]
  {
    common_len += 1;
  }

  let mut relative = PathBuf::new();

  for _ in common_len..from_components.len() {
    relative.push("..");
  }

  for component in &to_components[common_len..] {
    relative.push(component.as_os_str());
  }

  if relative.as_os_str().is_empty() {
    ".".to_string()
  } else {
    relative.to_string_lossy().replace('\\', "/")
  }
}

pub fn safe_url_segment(input: &str, max_len: usize) -> String {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return "untitled".to_string();
  }

  let mut out = String::with_capacity(trimmed.len());
  let mut last_dash = false;
  for ch in trimmed.chars() {
    let illegal = ch.is_control()
      || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
    if illegal || ch.is_whitespace() || ch == '.' {
      if !last_dash {
        out.push('-');
        last_dash = true;
      }
      continue;
    }
    out.push(ch);
    last_dash = false;
    if out.chars().count() >= max_len {
      break;
    }
  }

  let mut out = out.trim_matches(&['-', ' ', '.'][..]).to_string();
  if out.is_empty() {
    out = "untitled".to_string();
  }

  // Windows reserved device names (case-insensitive).
  let upper = out.to_ascii_uppercase();
  let reserved = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
    "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ];
  if reserved.contains(&upper.as_str()) {
    out = format!("_{}", out);
  }
  out
}

pub fn split_file_name(name: &str) -> (String, String) {
  match name.rsplit_once('.') {
    Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem.to_string(), format!(".{}", ext)),
    _ => (name.to_string(), String::new()),
  }
}

pub fn safe_file_name(original: &str, max_len: usize) -> String {
  let (stem, ext) = split_file_name(original);
  let safe_stem = safe_url_segment(&stem, max_len);
  let mut out = format!("{}{}", safe_stem, ext);
  out = out.trim_end_matches(['.', ' ']).to_string();
  if out.is_empty() {
    out = "file".to_string();
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn safe_url_segment_basic() {
    assert_eq!(safe_url_segment("Hello World", 80), "Hello-World");
    assert_eq!(safe_url_segment("a<>:\"/\\|?*b", 80), "a-b");
    assert_eq!(safe_url_segment("   ", 80), "untitled");
    assert_eq!(safe_url_segment("CON", 80), "_CON");
  }

  #[test]
  fn safe_file_name_basic() {
    assert_eq!(safe_file_name("a b.png", 80), "a-b.png");
    assert_eq!(safe_file_name("foo", 80), "foo");
  }

  #[test]
  fn relative_markdown_path_basic() {
    let from_dir = Path::new(r"C:\repo\src\content\blog");
    let to_path = Path::new(r"C:\repo\public\images\post\a.png");
    assert_eq!(relative_markdown_path(from_dir, to_path), "../../../public/images/post/a.png");
  }
}
