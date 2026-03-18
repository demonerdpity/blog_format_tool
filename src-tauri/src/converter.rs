use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::{
  AnalyzeResult, AppConfig, ConvertReport, FileNameStrategy, ImageCounts, ImageOp, MetaOptions, OutputType,
};
use crate::utils::{
  is_remote_url, is_site_images_path, relative_markdown_path, resolve_under_repo, safe_file_name, safe_url_segment,
  split_file_name,
};

#[derive(Debug, Clone)]
struct ParsedMarkdown {
  frontmatter: Mapping,
  body: String,
}

#[derive(Debug, Clone)]
struct ImageResolved {
  source_path: PathBuf,
  final_path: PathBuf,
  action: String,
}

fn now_date_string(date_format: &str) -> String {
  Local::now().format(date_format).to_string()
}

fn parse_output_type(s: &str) -> AppResult<OutputType> {
  match s.trim().to_ascii_lowercase().as_str() {
    "blog" => Ok(OutputType::Blog),
    "essays" => Ok(OutputType::Essays),
    other => Err(AppError::Message(format!("未知输出类型：{other}"))),
  }
}

fn frontmatter_key(key: &str) -> Value {
  Value::String(key.to_string())
}

fn get_string(fm: &Mapping, key: &str) -> Option<String> {
  fm.get(&frontmatter_key(key)).and_then(|v| match v {
    Value::String(s) => Some(s.clone()),
    Value::Number(n) => Some(n.to_string()),
    _ => None,
  })
}

fn set_string(fm: &mut Mapping, key: &str, value: String) {
  fm.insert(frontmatter_key(key), Value::String(value));
}

fn remove_key(fm: &mut Mapping, key: &str) {
  fm.remove(&frontmatter_key(key));
}

fn is_parseable_date(s: &str, date_format: &str) -> bool {
  NaiveDate::parse_from_str(s, date_format).is_ok()
    || DateTime::parse_from_rfc3339(s).is_ok()
    || NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").is_ok()
    || NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").is_ok()
}

fn parse_frontmatter_and_body(markdown: &str) -> AppResult<ParsedMarkdown> {
  let normalized = markdown.replace("\r\n", "\n");
  let mut lines = normalized.lines();
  let first = lines.next().unwrap_or("");
  if first.trim() != "---" {
    return Ok(ParsedMarkdown {
      frontmatter: Mapping::new(),
      body: normalized,
    });
  }

  let mut yaml_lines: Vec<&str> = Vec::new();
  let mut body_lines: Vec<&str> = Vec::new();
  let mut in_yaml = true;
  for line in lines {
    if in_yaml && line.trim() == "---" {
      in_yaml = false;
      continue;
    }
    if in_yaml {
      yaml_lines.push(line);
    } else {
      body_lines.push(line);
    }
  }

  let yaml_str = yaml_lines.join("\n");
  let frontmatter_value: Value = if yaml_str.trim().is_empty() {
    Value::Mapping(Mapping::new())
  } else {
    serde_yaml::from_str(&yaml_str)?
  };
  let frontmatter = match frontmatter_value {
    Value::Mapping(m) => m,
    _ => Mapping::new(),
  };

  Ok(ParsedMarkdown {
    frontmatter,
    body: body_lines.join("\n"),
  })
}

fn extract_title_from_first_h1(body: &str) -> (Option<String>, String) {
  let mut out_lines: Vec<&str> = Vec::new();
  let mut found: Option<String> = None;
  let mut in_fence = false;
  let mut fence_marker: Option<&str> = None;

  for line in body.lines() {
    let trimmed = line.trim_start();
    let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
    if is_fence {
      let marker = if trimmed.starts_with("```") { "```" } else { "~~~" };
      if in_fence {
        if fence_marker == Some(marker) {
          in_fence = false;
          fence_marker = None;
        }
      } else {
        in_fence = true;
        fence_marker = Some(marker);
      }
      out_lines.push(line);
      continue;
    }

    if found.is_none() && !in_fence {
      let t = trimmed;
      if t.starts_with("# ") {
        let mut title = t.trim_start_matches("# ").trim().to_string();
        title = title.trim_end_matches('#').trim().to_string();
        found = Some(title);
        continue;
      }
    }
    out_lines.push(line);
  }

  let mut out = out_lines.join("\n");
  if found.is_some() {
    out = out.strip_prefix("\n").unwrap_or(&out).to_string();
  }
  (found, out)
}

fn first_paragraph_plain_text(markdown_body: &str) -> String {
  let mut opts = Options::empty();
  opts.insert(Options::ENABLE_STRIKETHROUGH);

  let parser = Parser::new_ext(markdown_body, opts);
  let mut in_paragraph = false;
  let mut buf = String::new();

  for ev in parser {
    match ev {
      Event::Start(Tag::Paragraph) => {
        if buf.trim().is_empty() {
          in_paragraph = true;
        }
      }
      Event::End(TagEnd::Paragraph) => {
        if in_paragraph && !buf.trim().is_empty() {
          break;
        }
        in_paragraph = false;
      }
      Event::Text(t) | Event::Code(t) => {
        if in_paragraph {
          buf.push_str(&t);
        }
      }
      Event::SoftBreak | Event::HardBreak => {
        if in_paragraph {
          buf.push(' ');
        }
      }
      _ => {}
    }
  }

  buf.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(s: &str, max: usize) -> String {
  if max == 0 {
    return String::new();
  }
  let mut out = String::new();
  for (i, ch) in s.chars().enumerate() {
    if i >= max {
      break;
    }
    out.push(ch);
  }
  out
}

fn sha256_file_hex(path: &Path) -> AppResult<String> {
  let bytes = fs::read(path)?;
  let mut hasher = Sha256::new();
  hasher.update(&bytes);
  Ok(hex::encode(hasher.finalize()))
}

fn ensure_repo_root(config: &AppConfig) -> AppResult<PathBuf> {
  if config.repo_root.trim().is_empty() {
    return Err(AppError::Message(
      "repoRoot 为空：请先在 UI 中选择你的博客仓库根目录".to_string(),
    ));
  }
  Ok(PathBuf::from(config.repo_root.trim()))
}

fn compute_output_md_path(config: &AppConfig, output_type: OutputType, source_md: &Path, title: &str) -> AppResult<PathBuf> {
  let repo_root = ensure_repo_root(config)?;
  let out_dir = match output_type {
    OutputType::Blog => resolve_under_repo(&repo_root, &config.blog_content_dir),
    OutputType::Essays => resolve_under_repo(&repo_root, &config.essays_content_dir),
  };

  let source_name = source_md
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| AppError::Message("无法读取源 Markdown 文件名".to_string()))?;
  let (stem, ext) = split_file_name(source_name);
  let ext = if ext.is_empty() { ".md".to_string() } else { ext };

  let file_name = match config.file_name_strategy {
    FileNameStrategy::Original => format!("{}{}", safe_url_segment(&stem, 80), ext),
    FileNameStrategy::TitleSlug => format!("{}{}", safe_url_segment(title, 80), ext),
  };

  Ok(out_dir.join(file_name))
}

fn duplicate_output_warning(output_md_path: &Path, source_md: &Path) -> Option<String> {
  if !output_md_path.exists() {
    return None;
  }

  let existing = output_md_path.canonicalize().ok();
  let source = source_md.canonicalize().ok();
  if existing.is_some() && existing == source {
    return None;
  }

  Some(format!(
    "目标文章已存在，本次转换会覆盖：{}",
    output_md_path.display()
  ))
}

fn copy_or_reuse_image(dest_dir: &Path, src_abs: &Path) -> AppResult<ImageResolved> {
  let src_name = src_abs
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| AppError::Message(format!("无法读取图片文件名：{}", src_abs.display())))?;
  let safe_name = safe_file_name(src_name, 120);
  let candidate = dest_dir.join(&safe_name);

  fs::create_dir_all(dest_dir)?;
  if candidate.exists() {
    let src_hash = sha256_file_hex(src_abs)?;
    let dst_hash = sha256_file_hex(&candidate)?;
    if src_hash == dst_hash {
      return Ok(ImageResolved {
        source_path: src_abs.to_path_buf(),
        final_path: candidate,
        action: "skippedSame".to_string(),
      });
    }

    let (stem, ext) = split_file_name(&safe_name);
    for i in 1..=999 {
      let renamed = format!("{}-{}{}", stem, i, ext);
      let renamed_path = dest_dir.join(&renamed);
      if renamed_path.exists() {
        let src_hash = sha256_file_hex(src_abs)?;
        let dst_hash = sha256_file_hex(&renamed_path)?;
        if src_hash == dst_hash {
          return Ok(ImageResolved {
            source_path: src_abs.to_path_buf(),
            final_path: renamed_path,
            action: "skippedSame".to_string(),
          });
        }
        continue;
      }
      fs::copy(src_abs, &renamed_path)?;
      return Ok(ImageResolved {
        source_path: src_abs.to_path_buf(),
        final_path: renamed_path,
        action: "renamedCopied".to_string(),
      });
    }
    return Err(AppError::Message(format!(
      "图片重命名次数过多：{}",
      src_abs.display()
    )));
  }

  fs::copy(src_abs, &candidate)?;
  Ok(ImageResolved {
    source_path: src_abs.to_path_buf(),
    final_path: candidate,
    action: "copied".to_string(),
  })
}

fn resolve_local_image(md_dir: &Path, raw: &str) -> AppResult<PathBuf> {
  let raw = raw.trim().trim_matches('"').trim_matches('\'');
  let p = PathBuf::from(raw);
  let abs = if p.is_absolute() { p } else { md_dir.join(p) };
  if !abs.exists() {
    return Err(AppError::Message(format!(
      "找不到本地图片：{raw}（解析为：{}）",
      abs.display()
    )));
  }
  Ok(abs.canonicalize()?)
}

fn parse_md_image_inner(inner: &str) -> (String, String, bool) {
  let s = inner.trim();
  if s.starts_with('<') {
    if let Some(end) = s.find('>') {
      let path = s[1..end].to_string();
      let rest = s[end + 1..].to_string();
      return (path, rest, true);
    }
  }
  if s.starts_with('"') {
    if let Some(end) = s[1..].find('"') {
      let path = s[1..1 + end].to_string();
      let rest = s[1 + end + 1..].to_string();
      return (path, rest, true);
    }
  }
  if s.starts_with('\'') {
    if let Some(end) = s[1..].find('\'') {
      let path = s[1..1 + end].to_string();
      let rest = s[1 + end + 1..].to_string();
      return (path, rest, true);
    }
  }

  let mut path = s.to_string();
  let mut rest = String::new();
  for (idx, ch) in s.char_indices() {
    if ch.is_whitespace() {
      path = s[..idx].to_string();
      rest = s[idx..].to_string();
      break;
    }
  }
  (path, rest, false)
}

fn process_images_in_body(
  body: &str,
  md_dir: &Path,
  output_md_dir: &Path,
  images_target_dir: &Path,
  warnings: &mut Vec<String>,
  perform_copy_and_rewrite: bool,
) -> AppResult<(String, Vec<ImageResolved>, ImageCounts)> {
  let mut in_fence = false;
  let mut fence_marker: Option<&str> = None;

  let md_img_re = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").expect("regex");
  let html_img_re =
    Regex::new(r#"(<img[^>]*?\s+src\s*=\s*["'])([^"']+)(["'][^>]*>)"#).expect("regex");

  let mut cache: HashMap<String, ImageResolved> = HashMap::new();
  let mut resolved_list: Vec<ImageResolved> = Vec::new();
  let mut counts = ImageCounts {
    total: 0,
    local: 0,
    remote: 0,
    site: 0,
  };

  let mut out_lines: Vec<String> = Vec::new();
  for line in body.lines() {
    let trimmed = line.trim_start();
    let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
    if is_fence {
      let marker = if trimmed.starts_with("```") { "```" } else { "~~~" };
      if in_fence {
        if fence_marker == Some(marker) {
          in_fence = false;
          fence_marker = None;
        }
      } else {
        in_fence = true;
        fence_marker = Some(marker);
      }
      out_lines.push(line.to_string());
      continue;
    }

    if in_fence {
      out_lines.push(line.to_string());
      continue;
    }

    let mut replaced = md_img_re
      .replace_all(line, |caps: &regex::Captures<'_>| {
        counts.total += 1;
        let alt = &caps[1];
        let inner = &caps[2];
        let (path, rest, wrapped) = parse_md_image_inner(inner);

        if is_remote_url(&path) {
          counts.remote += 1;
          return caps[0].to_string();
        }
        if is_site_images_path(&path) {
          counts.site += 1;
          return caps[0].to_string();
        }

        counts.local += 1;
        match resolve_local_image(md_dir, &path) {
          Ok(abs) => {
            if !perform_copy_and_rewrite {
              return caps[0].to_string();
            }

            let abs_key = abs.to_string_lossy().to_string();
            let resolved = if let Some(existing) = cache.get(&abs_key) {
              existing.clone()
            } else {
              match copy_or_reuse_image(images_target_dir, &abs) {
                Ok(r) => {
                  cache.insert(abs_key.clone(), r.clone());
                  resolved_list.push(r.clone());
                  r
                }
                Err(e) => {
                  warnings.push(e.to_string());
                  return caps[0].to_string();
                }
              }
            };

            let relative_path = relative_markdown_path(output_md_dir, &resolved.final_path);
            let new_dest = if wrapped {
              format!("<{}>", relative_path)
            } else {
              relative_path
            };
            format!("![{}]({}{})", alt, new_dest, rest)
          }
          Err(e) => {
            warnings.push(e.to_string());
            caps[0].to_string()
          }
        }
      })
      .to_string();

    replaced = html_img_re
      .replace_all(&replaced, |caps: &regex::Captures<'_>| {
        counts.total += 1;
        let prefix = &caps[1];
        let src = &caps[2];
        let suffix = &caps[3];

        if is_remote_url(src) {
          counts.remote += 1;
          return caps[0].to_string();
        }
        if is_site_images_path(src) {
          counts.site += 1;
          return caps[0].to_string();
        }

        counts.local += 1;
        match resolve_local_image(md_dir, src) {
          Ok(abs) => {
            if !perform_copy_and_rewrite {
              return caps[0].to_string();
            }

            let abs_key = abs.to_string_lossy().to_string();
            let resolved = if let Some(existing) = cache.get(&abs_key) {
              existing.clone()
            } else {
              match copy_or_reuse_image(images_target_dir, &abs) {
                Ok(r) => {
                  cache.insert(abs_key.clone(), r.clone());
                  resolved_list.push(r.clone());
                  r
                }
                Err(e) => {
                  warnings.push(e.to_string());
                  return caps[0].to_string();
                }
              }
            };
            let relative_path = relative_markdown_path(output_md_dir, &resolved.final_path);
            format!("{}{}{}", prefix, relative_path, suffix)
          }
          Err(e) => {
            warnings.push(e.to_string());
            caps[0].to_string()
          }
        }
      })
      .to_string();

    out_lines.push(replaced);
  }

  Ok((out_lines.join("\n"), resolved_list, counts))
}

fn mapping_to_frontmatter_text(fm: &Mapping) -> AppResult<String> {
  let yaml = serde_yaml::to_string(&Value::Mapping(fm.clone()))?;
  Ok(format!("---\n{}---\n", yaml))
}

pub fn analyze_file(md_path: &str, output_type_raw: &str, config: &AppConfig) -> AppResult<AnalyzeResult> {
  let output_type = parse_output_type(output_type_raw)?;
  let md_path = PathBuf::from(md_path);
  let md_dir = md_path
    .parent()
    .ok_or_else(|| AppError::Message("无法读取 Markdown 所在目录".to_string()))?;

  let markdown = fs::read_to_string(&md_path)?;
  let parsed = parse_frontmatter_and_body(&markdown)?;
  let (derived_title, body_wo_h1) = extract_title_from_first_h1(&parsed.body);
  let title = derived_title.or_else(|| get_string(&parsed.frontmatter, "title"));
  let title = match title {
    Some(t) if !t.trim().is_empty() => t,
    _ => {
      return Err(AppError::Message(
        "未找到 H1 且 frontmatter 里也没有 title：请补齐 title".to_string(),
      ))
    }
  };
  let safe_title = safe_url_segment(&title, 80);
  let output_md_path = compute_output_md_path(config, output_type, &md_path, &title)?;
  let output_md_dir = output_md_path
    .parent()
    .ok_or_else(|| AppError::Message("无法读取输出 Markdown 所在目录".to_string()))?;

  let repo_root = ensure_repo_root(config)?;
  let images_root = resolve_under_repo(&repo_root, &config.images_dir);
  let images_target_dir = images_root.join(&safe_title);

  let mut warnings: Vec<String> = Vec::new();
  if let Some(message) = duplicate_output_warning(&output_md_path, &md_path) {
    warnings.push(message);
  }
  let (_, _, counts) = process_images_in_body(
    &body_wo_h1,
    md_dir,
    output_md_dir,
    &images_target_dir,
    &mut warnings,
    false,
  )?;

  Ok(AnalyzeResult {
    title: Some(title),
    safe_title: Some(safe_title),
    image_counts: counts,
    output_markdown_path: Some(output_md_path.to_string_lossy().to_string()),
    warnings,
  })
}

pub fn convert_file(
  md_path: &str,
  output_type_raw: &str,
  config: &AppConfig,
  meta: &MetaOptions,
) -> AppResult<ConvertReport> {
  let output_type = parse_output_type(output_type_raw)?;
  let md_path = PathBuf::from(md_path);
  let md_dir = md_path
    .parent()
    .ok_or_else(|| AppError::Message("无法读取 Markdown 所在目录".to_string()))?;

  let markdown = fs::read_to_string(&md_path)?;
  let parsed = parse_frontmatter_and_body(&markdown)?;

  let (derived_title, body_wo_h1) = extract_title_from_first_h1(&parsed.body);
  let mut fm = parsed.frontmatter;
  let title = derived_title.or_else(|| get_string(&fm, "title"));
  let title = match title {
    Some(t) if !t.trim().is_empty() => t,
    _ => {
      return Err(AppError::Message(
        "未找到 H1 且 frontmatter 里也没有 title：请补齐 title".to_string(),
      ))
    }
  };
  set_string(&mut fm, "title", title.clone());

  let safe_title = safe_url_segment(&title, 80);
  let today = now_date_string(&config.date_format);
  let output_md_path = compute_output_md_path(config, output_type, &md_path, &title)?;
  let output_md_dir = output_md_path
    .parent()
    .ok_or_else(|| AppError::Message("无法读取输出 Markdown 所在目录".to_string()))?;

  let pub_date_current = get_string(&fm, "pubDate");
  let should_set_pub = match pub_date_current.as_deref() {
    Some(s) if is_parseable_date(s, &config.date_format) => false,
    _ => true,
  };
  if should_set_pub {
    set_string(&mut fm, "pubDate", today.clone());
  }

  set_string(&mut fm, "updatedDate", today.clone());

  let existing_desc = get_string(&fm, "description").unwrap_or_default();
  let desc = if !meta.description_override && !existing_desc.trim().is_empty() {
    existing_desc
  } else if meta.description_override && !meta.description.trim().is_empty() {
    meta.description.trim().to_string()
  } else {
    let auto = first_paragraph_plain_text(&body_wo_h1);
    truncate_chars(&auto, config.description_auto_length)
  };
  if desc.trim().is_empty() {
    return Err(AppError::Message(
      "description 不能为空：请勾选并填写，或确保正文有可生成摘要的段落".to_string(),
    ));
  }
  set_string(&mut fm, "description", desc);

  match output_type {
    OutputType::Blog => {
      if meta.tags_override {
        let tags: Vec<Value> = meta
          .tags
          .iter()
          .map(|t| t.trim())
          .filter(|t| !t.is_empty())
          .map(|t| Value::String(t.to_string()))
          .collect();
        fm.insert(frontmatter_key("tags"), Value::Sequence(tags));
      }
    }
    OutputType::Essays => {
      remove_key(&mut fm, "tags");
    }
  }

  let repo_root = ensure_repo_root(config)?;
  let images_root = resolve_under_repo(&repo_root, &config.images_dir);
  let images_target_dir = images_root.join(&safe_title);

  let mut warnings: Vec<String> = Vec::new();
  if let Some(message) = duplicate_output_warning(&output_md_path, &md_path) {
    warnings.push(message);
  }
  let (rewritten_body, images_resolved, _) =
    process_images_in_body(&body_wo_h1, md_dir, output_md_dir, &images_target_dir, &mut warnings, true)?;

  let mut hero_op: Option<ImageResolved> = None;
  if meta.hero_image_override {
    let hero_path = meta
      .hero_image_path
      .as_deref()
      .ok_or_else(|| AppError::Message("已勾选 heroImage 但未选择图片".to_string()))?;
    if is_remote_url(hero_path) || is_site_images_path(hero_path) {
      set_string(&mut fm, "heroImage", hero_path.to_string());
    } else {
      let abs = resolve_local_image(md_dir, hero_path)?;
      let resolved = copy_or_reuse_image(&images_target_dir, &abs)?;
      let relative_path = relative_markdown_path(output_md_dir, &resolved.final_path);
      set_string(&mut fm, "heroImage", relative_path);
      hero_op = Some(resolved);
    }
  }

  let fm_text = mapping_to_frontmatter_text(&fm)?;
  if let Some(parent) = output_md_path.parent() {
    fs::create_dir_all(parent)?;
  }
  fs::write(
    &output_md_path,
    format!("{}\n{}", fm_text, rewritten_body.trim_start_matches('\n')),
  )?;

  let mut ops: Vec<ImageOp> = images_resolved
    .into_iter()
    .map(|img| ImageOp {
      source_path: img.source_path.to_string_lossy().to_string(),
      final_path: img.final_path.to_string_lossy().to_string(),
      final_site_path: relative_markdown_path(output_md_dir, &img.final_path),
      action: img.action,
    })
    .collect();

  if let Some(hero) = hero_op {
    ops.push(ImageOp {
      source_path: hero.source_path.to_string_lossy().to_string(),
      final_path: hero.final_path.to_string_lossy().to_string(),
      final_site_path: relative_markdown_path(output_md_dir, &hero.final_path),
      action: hero.action,
    });
  }

  Ok(ConvertReport {
    output_markdown_path: output_md_path.to_string_lossy().to_string(),
    images: ops,
    warnings,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn parse_frontmatter(md: &str) -> Mapping {
    let normalized = md.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    assert_eq!(lines.next().unwrap_or(""), "---");
    let mut yaml = String::new();
    for line in lines {
      if line.trim() == "---" {
        break;
      }
      yaml.push_str(line);
      yaml.push('\n');
    }
    let v: Value = serde_yaml::from_str(&yaml).expect("yaml");
    match v {
      Value::Mapping(m) => m,
      _ => Mapping::new(),
    }
  }

  #[test]
  fn convert_copies_images_and_rewrites_paths() -> AppResult<()> {
    let repo = tempfile::tempdir().expect("repo tempdir");
    let source = tempfile::tempdir().expect("source tempdir");

    fs::create_dir_all(repo.path().join("src/content/blog")).expect("mkdir blog");
    fs::create_dir_all(repo.path().join("src/content/essays")).expect("mkdir essays");
    fs::create_dir_all(repo.path().join("public/images")).expect("mkdir images");

    fs::create_dir_all(source.path().join("img")).expect("mkdir img");
    fs::write(source.path().join("img/a.png"), b"fake").expect("write img");

    let md_path = source.path().join("post.md");
    fs::write(
      &md_path,
      "# Hello World\n\nFirst paragraph.\n\n![](./img/a.png)\n",
    )
    .expect("write md");

    let mut config = AppConfig::default();
    config.repo_root = repo.path().to_string_lossy().to_string();

    let meta = MetaOptions {
      description_override: false,
      description: String::new(),
      tags_override: false,
      tags: vec![],
      hero_image_override: false,
      hero_image_path: None,
    };

    let report = convert_file(&md_path.to_string_lossy(), "blog", &config, &meta)?;
    let output_path = PathBuf::from(&report.output_markdown_path);
    assert!(output_path.exists());

    let out_md = fs::read_to_string(&output_path)?;
    assert!(!out_md.contains("# Hello World"));
    assert!(out_md.contains("../../../public/images/Hello-World/a.png"));

    let fm = parse_frontmatter(&out_md);
    assert_eq!(get_string(&fm, "title").as_deref(), Some("Hello World"));
    assert!(get_string(&fm, "description").unwrap_or_default().trim().len() > 0);
    assert!(get_string(&fm, "pubDate").unwrap_or_default().trim().len() > 0);
    assert!(get_string(&fm, "updatedDate").unwrap_or_default().trim().len() > 0);

    let copied = repo.path().join("public/images/Hello-World/a.png");
    assert!(copied.exists());

    Ok(())
  }

  #[test]
  fn essays_removes_tags() -> AppResult<()> {
    let repo = tempfile::tempdir().expect("repo tempdir");
    let source = tempfile::tempdir().expect("source tempdir");

    fs::create_dir_all(repo.path().join("src/content/essays")).expect("mkdir essays");
    fs::create_dir_all(repo.path().join("public/images")).expect("mkdir images");

    let md_path = source.path().join("note.md");
    fs::write(
      &md_path,
      "---\n\
title: Old\n\
description: Old desc\n\
tags:\n\
  - a\n\
  - b\n\
---\n\
\n\
# New Title\n\
\n\
Hello.\n",
    )
    .expect("write md");

    let mut config = AppConfig::default();
    config.repo_root = repo.path().to_string_lossy().to_string();

    let meta = MetaOptions {
      description_override: false,
      description: String::new(),
      tags_override: false,
      tags: vec![],
      hero_image_override: false,
      hero_image_path: None,
    };

    let report = convert_file(&md_path.to_string_lossy(), "essays", &config, &meta)?;
    let out_md = fs::read_to_string(&report.output_markdown_path)?;
    let fm = parse_frontmatter(&out_md);
    assert!(fm.get(&frontmatter_key("tags")).is_none());
    Ok(())
  }

  #[test]
  fn convert_warns_and_overwrites_existing_output() -> AppResult<()> {
    let repo = tempfile::tempdir().expect("repo tempdir");
    let source = tempfile::tempdir().expect("source tempdir");

    fs::create_dir_all(repo.path().join("src/content/blog")).expect("mkdir blog");
    fs::create_dir_all(repo.path().join("public/images")).expect("mkdir images");
    fs::write(repo.path().join("src/content/blog/post.md"), "existing").expect("write existing post");

    let md_path = source.path().join("post.md");
    fs::write(&md_path, "# Same Name\n\nBody.\n").expect("write md");

    let mut config = AppConfig::default();
    config.repo_root = repo.path().to_string_lossy().to_string();

    let meta = MetaOptions {
      description_override: false,
      description: String::new(),
      tags_override: false,
      tags: vec![],
      hero_image_override: false,
      hero_image_path: None,
    };

    let report = convert_file(&md_path.to_string_lossy(), "blog", &config, &meta)?;
    assert!(report.warnings.iter().any(|warning| warning.contains("本次转换会覆盖")));
    let out_md = fs::read_to_string(&report.output_markdown_path)?;
    assert!(out_md.contains("title: Same Name"));
    assert!(out_md.contains("description: Body."));
    Ok(())
  }
}
