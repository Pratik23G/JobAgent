// content.js — ATS form detector and auto-filler
// Supports: Greenhouse, Lever, Workday, LinkedIn, Indeed, Workable, SmartRecruiters, BambooHR, Ashby

// ─── Utility: improved dropdown matching with exact-first + fuzzy ────────────
function setFieldValue(el, value) {
  if (!el || !value) return false;

  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const options = Array.from(el.options);
    const valueLower = value.toLowerCase().trim();

    // 1. Exact match on text or value
    let match = options.find(o =>
      o.text.trim().toLowerCase() === valueLower ||
      o.value.trim().toLowerCase() === valueLower
    );

    // 2. Partial match (contains)
    if (!match) {
      match = options.find(o =>
        o.text.toLowerCase().includes(valueLower) ||
        o.value.toLowerCase().includes(valueLower)
      );
    }

    // 3. Reverse partial (value contained in option text)
    if (!match) {
      match = options.find(o =>
        valueLower.includes(o.text.trim().toLowerCase()) && o.text.trim().length > 1
      );
    }

    // 4. Fuzzy match — find closest by Levenshtein distance
    if (!match && valueLower.length > 2) {
      let bestDist = Infinity;
      for (const o of options) {
        if (!o.value || o.value === "" || o.disabled) continue;
        const dist = levenshtein(valueLower, o.text.trim().toLowerCase());
        if (dist < bestDist && dist <= Math.max(3, valueLower.length * 0.4)) {
          bestDist = dist;
          match = o;
        }
      }
    }

    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  if (tag === "textarea" || (tag === "input" && ["text", "email", "tel", "url", "number", "date", "month"].includes(el.type))) {
    el.focus();
    el.value = value;

    // React uses a synthetic event system — trigger the native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  // ContentEditable divs (used by some modern ATS)
  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

// Levenshtein distance for fuzzy dropdown matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Utility: set radio button by matching label or value ────────────────────
function setRadioValue(fieldName, value) {
  if (!value) return false;
  const valueLower = value.toLowerCase().trim();

  // Find radio buttons by name attribute
  const radios = document.querySelectorAll(`input[type="radio"][name="${fieldName}"]`);
  if (radios.length > 0) {
    for (const radio of radios) {
      const radioLabel = getLabelForElement(radio).toLowerCase();
      const radioValue = (radio.value || "").toLowerCase();
      if (radioValue === valueLower || radioLabel.includes(valueLower) || valueLower.includes(radioLabel)) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        radio.dispatchEvent(new Event("click", { bubbles: true }));
        return true;
      }
    }
  }

  // Also search by label text association
  const allRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of allRadios) {
    const labelText = getLabelForElement(radio).toLowerCase();
    if (labelText.includes(fieldName.toLowerCase())) {
      const radioValue = (radio.value || "").toLowerCase();
      const radioLabel = getLabelForElement(radio).toLowerCase();
      // Match "yes"/"no" or specific values
      if (radioValue === valueLower || radioLabel.includes(valueLower)) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        radio.dispatchEvent(new Event("click", { bubbles: true }));
        return true;
      }
    }
  }

  return false;
}

// ─── Utility: set checkbox value ─────────────────────────────────────────────
function setCheckboxValue(el, shouldCheck) {
  if (!el || el.type !== "checkbox") return false;
  if (el.checked !== shouldCheck) {
    el.checked = shouldCheck;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("click", { bubbles: true }));
  }
  return true;
}

// ─── Utility: get label text for any form element ────────────────────────────
function getLabelForElement(el) {
  // Check explicit label via for attribute
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  // Check parent label
  const parentLabel = el.closest("label");
  if (parentLabel) return parentLabel.textContent.trim();

  // Check sibling label
  const prev = el.previousElementSibling;
  if (prev && prev.tagName === "LABEL") return prev.textContent.trim();

  // Check parent container for label
  const container = el.closest(".field, .form-group, [class*='field'], [class*='form-element'], [class*='question']");
  if (container) {
    const label = container.querySelector("label, [class*='label'], .field-label, legend");
    if (label) return label.textContent.trim();
  }

  // Fallback to aria-label or placeholder
  return el.getAttribute("aria-label") || el.placeholder || el.name || "";
}

// ─── Utility: find radio/checkbox groups by question text ────────────────────
function findRadioGroupByQuestion(questionText) {
  const questionLower = questionText.toLowerCase();
  const fieldsets = document.querySelectorAll("fieldset, [role='radiogroup'], [class*='question'], [class*='field-group']");

  for (const fieldset of fieldsets) {
    const legend = fieldset.querySelector("legend, label, [class*='label'], [class*='question-text']");
    if (legend && legend.textContent.toLowerCase().includes(questionLower)) {
      return fieldset.querySelectorAll('input[type="radio"]');
    }
  }

  // Search all labels for the question text, then find nearby radios
  const labels = document.querySelectorAll("label, [class*='label'], legend, span[class*='question']");
  for (const label of labels) {
    if (label.textContent.toLowerCase().includes(questionLower)) {
      const container = label.closest("[class*='field'], [class*='form-group'], [class*='question'], fieldset, [class*='row']");
      if (container) {
        const radios = container.querySelectorAll('input[type="radio"]');
        if (radios.length > 0) return radios;
      }
    }
  }

  return null;
}

// Select radio from a group by matching the desired value
function selectRadioByValue(radios, value) {
  if (!radios || radios.length === 0 || !value) return false;
  const valueLower = value.toLowerCase().trim();

  for (const radio of radios) {
    const radioLabel = getLabelForElement(radio).toLowerCase();
    const radioValue = (radio.value || "").toLowerCase();
    if (radioValue === valueLower || radioLabel === valueLower ||
        radioLabel.includes(valueLower) || valueLower.includes(radioLabel)) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      radio.dispatchEvent(new Event("click", { bubbles: true }));
      return true;
    }
  }
  return false;
}

// ─── Fill common yes/no and work-related radio/checkbox questions ─────────────
function fillCommonQuestions(profile, pack) {
  const results = [];

  // Question patterns → value mapping
  const radioQuestions = [
    {
      patterns: ["authorized to work", "legally authorized", "work authorization", "eligible to work", "right to work"],
      value: profile.workAuthorization ? "yes" : null,
      name: "Work Authorization",
    },
    {
      patterns: ["require sponsorship", "visa sponsorship", "need sponsorship", "immigration sponsorship"],
      value: profile.workAuthorization && ["us citizen", "green card", "permanent resident"].some(v =>
        (profile.workAuthorization || "").toLowerCase().includes(v)) ? "no" : "yes",
      name: "Visa Sponsorship",
    },
    {
      patterns: ["18 years", "at least 18", "age requirement", "over 18"],
      value: "yes",
      name: "Age Requirement",
    },
    {
      patterns: ["willing to relocate", "open to relocation", "relocate"],
      value: "yes",
      name: "Relocation",
    },
    {
      patterns: ["background check", "consent to background"],
      value: "yes",
      name: "Background Check",
    },
    {
      patterns: ["drug test", "drug screening"],
      value: "yes",
      name: "Drug Test Consent",
    },
  ];

  for (const q of radioQuestions) {
    if (!q.value) continue;
    for (const pattern of q.patterns) {
      const radios = findRadioGroupByQuestion(pattern);
      if (radios && radios.length > 0) {
        const filled = selectRadioByValue(radios, q.value);
        if (filled) {
          results.push({ name: q.name, filled: true });
          break;
        }
      }
    }
  }

  // Handle checkboxes for agreements (terms, privacy, etc.)
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    if (cb.checked) continue;
    const labelText = getLabelForElement(cb).toLowerCase();
    if (labelText.includes("agree") || labelText.includes("terms") ||
        labelText.includes("privacy") || labelText.includes("acknowledge") ||
        labelText.includes("consent") || labelText.includes("confirm")) {
      setCheckboxValue(cb, true);
      results.push({ name: "Agreement Checkbox", filled: true });
    }
  }

  // Salary expectations — fill if there's a field for it
  if (pack?.common_answers?.salary_expectations) {
    const salaryField = findFieldByLabel("salary") || findFieldByLabel("compensation") ||
      findFieldByLabel("pay") || findFieldByLabel("desired salary");
    if (salaryField && !salaryField.value) {
      const filled = setFieldValue(salaryField, pack.common_answers.salary_expectations);
      if (filled) results.push({ name: "Salary Expectations", filled: true });
    }
  }

  // Greatest strength
  if (pack?.common_answers?.greatest_strength) {
    const strengthField = findFieldByLabel("greatest strength") || findFieldByLabel("strength");
    if (strengthField && !strengthField.value) {
      const filled = setFieldValue(strengthField, pack.common_answers.greatest_strength);
      if (filled) results.push({ name: "Greatest Strength", filled: true });
    }
  }

  return results;
}

// ─── File upload via DataTransfer API ─────────────────────────────────────────
async function uploadFileToInput(fileInput, fileData, fileName, mimeType) {
  if (!fileInput || fileInput.type !== "file") return false;

  try {
    // Convert base64 data to blob
    let blob;
    if (typeof fileData === "string" && fileData.startsWith("data:")) {
      const res = await fetch(fileData);
      blob = await res.blob();
    } else if (typeof fileData === "string") {
      // base64 string without data URI prefix
      const binary = atob(fileData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mimeType || "application/pdf" });
    } else {
      return false;
    }

    const file = new File([blob], fileName || "resume.pdf", {
      type: mimeType || "application/pdf",
    });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Trigger events so the ATS picks up the file
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    return true;
  } catch (err) {
    // file upload failed
    return false;
  }
}

// Find file input for resume uploads — searches visible AND hidden inputs
function findResumeFileInput() {
  // First, try visible file inputs
  const fileInputs = document.querySelectorAll('input[type="file"]');
  for (const input of fileInputs) {
    const accept = (input.accept || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();

    const label = input.closest("label") ||
      (input.id && document.querySelector(`label[for="${input.id}"]`));
    const labelText = (label?.textContent || "").toLowerCase();

    // Also check surrounding text (parent containers)
    const parentText = (input.closest("[class*='upload'], [class*='drop'], [class*='file'], [class*='resume']")?.textContent || "").toLowerCase();

    if (accept.includes("pdf") || accept.includes("doc") ||
        name.includes("resume") || name.includes("cv") || name.includes("file") ||
        id.includes("resume") || id.includes("cv") ||
        ariaLabel.includes("resume") || ariaLabel.includes("cv") ||
        labelText.includes("resume") || labelText.includes("cv") ||
        labelText.includes("upload") ||
        parentText.includes("resume") || parentText.includes("cv") ||
        parentText.includes("upload") || parentText.includes("attach")) {
      return input;
    }
  }

  // Fallback: return the first file input
  if (fileInputs.length === 1) return fileInputs[0];

  // Some ATS (Ashby, etc.) hide the file input. Look for hidden ones inside dropzone areas.
  const hiddenInputs = document.querySelectorAll('input[type="file"][style*="display: none"], input[type="file"][style*="opacity: 0"], input[type="file"][hidden], input[type="file"][class*="hidden"]');
  if (hiddenInputs.length > 0) return hiddenInputs[0];

  // Last resort: look for any file input at all, even deeply nested
  const allFileInputs = document.querySelectorAll('input[type="file"]');
  if (allFileInputs.length > 0) return allFileInputs[0];

  return null;
}

// ─── Field matcher: find form fields by label text or attributes ─────────────
function findFieldByLabel(labelText) {
  const labels = document.querySelectorAll("label");
  for (const label of labels) {
    if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
      if (label.htmlFor) {
        const field = document.getElementById(label.htmlFor);
        if (field) return field;
      }
      const nested = label.querySelector("input, textarea, select");
      if (nested) return nested;
      const sibling = label.nextElementSibling;
      if (sibling && ["INPUT", "TEXTAREA", "SELECT"].includes(sibling.tagName)) {
        return sibling;
      }
      const parent = label.closest(".field, .form-group, [class*='field'], [class*='form']");
      if (parent) {
        const input = parent.querySelector("input, textarea, select");
        if (input) return input;
      }
    }
  }

  // Fallback: search by placeholder, name, id, or aria-label
  const allInputs = document.querySelectorAll("input, textarea, select");
  for (const input of allInputs) {
    const placeholder = (input.placeholder || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();
    const searchTerm = labelText.toLowerCase();

    if (placeholder.includes(searchTerm) || name.includes(searchTerm) ||
        id.includes(searchTerm) || ariaLabel.includes(searchTerm)) {
      return input;
    }
  }

  return null;
}

// ─── Fill address fields ─────────────────────────────────────────────────────
function fillAddressFields(profile) {
  const results = [];

  const addressFields = [
    { name: "Street Address", labels: ["street", "address line 1", "address_line_1", "address1", "street address", "mailing address"], value: profile.address },
    { name: "Address Line 2", labels: ["address line 2", "address_line_2", "address2", "apt", "suite", "unit"], value: "" },
    { name: "City", labels: ["city", "town"], value: profile.city },
    { name: "State", labels: ["state", "province", "state/province", "region"], value: profile.state },
    { name: "Zip Code", labels: ["zip", "postal", "zip code", "postal code", "zipcode"], value: profile.zip },
    { name: "Country", labels: ["country", "nation"], value: profile.country },
  ];

  for (const field of addressFields) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      if (filled) results.push({ name: field.name, filled: true });
    }
  }

  return results;
}

// ─── Fill education fields ───────────────────────────────────────────────────
function fillEducationFields(profile) {
  const results = [];
  if (!profile.education || profile.education.length === 0) return results;

  // Click "Add Education" button if present (for repeating sections)
  const addBtns = document.querySelectorAll("button, a");
  for (const btn of addBtns) {
    const text = (btn.textContent || "").toLowerCase().trim();
    if (text.includes("add education") || text.includes("add school") || text.includes("add degree")) {
      // Only click if no education fields exist yet
      const existing = findFieldByLabel("school") || findFieldByLabel("university") || findFieldByLabel("degree");
      if (!existing) {
        btn.click();
        // Wait for DOM to update
        break;
      }
    }
  }

  const edu = profile.education[0]; // Fill most recent education
  if (!edu) return results;

  const eduFields = [
    { name: "School", labels: ["school", "university", "institution", "college", "school name"], value: edu.school },
    { name: "Degree", labels: ["degree", "level of education", "education level", "degree type"], value: edu.degree },
    { name: "Field of Study", labels: ["field of study", "major", "discipline", "area of study", "concentration"], value: edu.fieldOfStudy },
    { name: "Graduation Year", labels: ["graduation", "grad year", "year", "end date", "completion"], value: edu.graduationYear },
    { name: "GPA", labels: ["gpa", "grade", "cgpa", "grade point"], value: edu.gpa },
  ];

  for (const field of eduFields) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      if (filled) results.push({ name: field.name, filled: true });
    }
  }

  return results;
}

// ─── Fill work experience fields ─────────────────────────────────────────────
function fillExperienceFields(profile) {
  const results = [];
  if (!profile.experience || profile.experience.length === 0) return results;

  // Click "Add Experience" button if present
  const addBtns = document.querySelectorAll("button, a");
  for (const btn of addBtns) {
    const text = (btn.textContent || "").toLowerCase().trim();
    if (text.includes("add experience") || text.includes("add work") || text.includes("add position") || text.includes("add employment")) {
      const existing = findFieldByLabel("company name") || findFieldByLabel("employer");
      if (!existing) {
        btn.click();
        break;
      }
    }
  }

  const exp = profile.experience[0]; // Fill most recent experience
  if (!exp) return results;

  const expFields = [
    { name: "Company Name", labels: ["company", "employer", "company name", "organization", "employer name"], value: exp.company },
    { name: "Job Title", labels: ["job title", "title", "position", "role", "position title"], value: exp.title },
    { name: "Start Date", labels: ["start date", "from", "start"], value: exp.startDate },
    { name: "End Date", labels: ["end date", "to", "end"], value: exp.endDate },
    { name: "Job Description", labels: ["description", "responsibilities", "duties", "job description", "role description"], value: exp.description },
    { name: "Job Location", labels: ["work location", "job location"], value: exp.location },
  ];

  for (const field of expFields) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      if (filled) results.push({ name: field.name, filled: true });
    }
  }

  return results;
}

// ─── Fill skills fields ──────────────────────────────────────────────────────
function fillSkillsFields(profile) {
  const results = [];
  if (!profile.skills || profile.skills.length === 0) return results;

  // Pattern 1: Tag-style inputs (type skill + press Enter)
  const skillInput = findFieldByLabel("skills") || findFieldByLabel("add skill") || findFieldByLabel("skill");
  if (skillInput && skillInput.tagName === "INPUT" && !skillInput.value) {
    // Check if this is a tag input (usually has a container with existing tags)
    const container = skillInput.closest("[class*='tag'], [class*='skill'], [class*='chip'], [class*='token']");
    if (container) {
      // Tag input — enter skills one by one
      for (const skill of profile.skills.slice(0, 10)) { // Limit to 10 to avoid spam
        skillInput.focus();
        setFieldValue(skillInput, skill);
        skillInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        skillInput.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", bubbles: true }));
        skillInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      }
      results.push({ name: "Skills (tags)", filled: true });
    } else {
      // Simple text input — join skills with commas
      const filled = setFieldValue(skillInput, profile.skills.join(", "));
      if (filled) results.push({ name: "Skills", filled: true });
    }
  }

  // Pattern 2: Multi-select dropdown
  const skillSelect = document.querySelector("select[name*='skill'], select[id*='skill']");
  if (skillSelect && skillSelect.multiple) {
    const options = Array.from(skillSelect.options);
    let matched = 0;
    for (const skill of profile.skills) {
      const skillLower = skill.toLowerCase();
      const option = options.find(o =>
        o.text.toLowerCase().includes(skillLower) || o.value.toLowerCase().includes(skillLower)
      );
      if (option) {
        option.selected = true;
        matched++;
      }
    }
    if (matched > 0) {
      skillSelect.dispatchEvent(new Event("change", { bubbles: true }));
      results.push({ name: `Skills (${matched} selected)`, filled: true });
    }
  }

  // Pattern 3: Checkbox list of skills
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  let skillCheckboxCount = 0;
  for (const cb of checkboxes) {
    if (cb.checked) continue;
    const labelText = getLabelForElement(cb).toLowerCase();
    // Only match if the checkbox is in a skills-related section
    const section = cb.closest("[class*='skill'], [class*='competenc'], fieldset");
    if (!section) continue;

    for (const skill of profile.skills) {
      if (labelText.includes(skill.toLowerCase()) || skill.toLowerCase().includes(labelText)) {
        setCheckboxValue(cb, true);
        skillCheckboxCount++;
        break;
      }
    }
  }
  if (skillCheckboxCount > 0) {
    results.push({ name: `Skills (${skillCheckboxCount} checked)`, filled: true });
  }

  return results;
}

// ─── Generic field filler (works across most ATS) ────────────────────────────
function fillGenericFields(pack, profile) {
  const results = [];

  // Common field patterns across all ATS platforms
  const fieldMap = [
    { name: "First Name", labels: ["first name", "first_name", "firstname", "given name"], value: profile.firstName },
    { name: "Last Name", labels: ["last name", "last_name", "lastname", "surname", "family name"], value: profile.lastName },
    { name: "Full Name", labels: ["full name", "name", "your name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", labels: ["email", "e-mail", "email address"], value: profile.email },
    { name: "Phone", labels: ["phone", "telephone", "mobile", "phone number", "cell"], value: profile.phone },
    { name: "Location", labels: ["location", "city", "address"], value: profile.location },
    { name: "LinkedIn", labels: ["linkedin", "linkedin url", "linkedin profile"], value: profile.linkedin },
    { name: "Website", labels: ["website", "portfolio", "personal website", "github"], value: profile.website },
    { name: "Current Company", labels: ["current company", "company", "current employer", "organization"], value: profile.currentCompany },
    { name: "Current Title", labels: ["current title", "job title", "current role", "current position"], value: profile.currentTitle },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Address fields
  const addressResults = fillAddressFields(profile);
  results.push(...addressResults);

  // Education fields
  const eduResults = fillEducationFields(profile);
  results.push(...eduResults);

  // Experience fields
  const expResults = fillExperienceFields(profile);
  results.push(...expResults);

  // Skills
  const skillResults = fillSkillsFields(profile);
  results.push(...skillResults);

  // Common radio/checkbox questions (work auth, sponsorship, etc.)
  const questionResults = fillCommonQuestions(profile, pack);
  results.push(...questionResults);

  // Cover letter / additional info
  if (pack.cover_letter) {
    const coverField = findFieldByLabel("cover letter") ||
      findFieldByLabel("additional information") ||
      findFieldByLabel("additional") ||
      findFieldByLabel("comments");
    if (coverField && !coverField.value) {
      setFieldValue(coverField, pack.cover_letter);
      results.push({ name: "Cover Letter", filled: true });
    }
  }

  // "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue; // Skip if already filled
    const label = ta.closest(".field, .form-group, [class*='field']")?.querySelector("label")?.textContent || "";
    const placeholder = ta.placeholder || "";
    const combined = (label + " " + placeholder).toLowerCase();

    if (combined.includes("why") && (combined.includes("company") || combined.includes("role") || combined.includes("interested") || combined.includes("position"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40) || "Why Question", filled: true });
      }
    }
  }

  return results;
}

// ─── ATS-specific fillers ───────────────────────────────────────────────────

function fillGreenhouse(pack, profile) {
  const results = [];

  const fieldMap = [
    { name: "First Name", selectors: ["#first_name", "[name='first_name']"], value: profile.firstName },
    { name: "Last Name", selectors: ["#last_name", "[name='last_name']"], value: profile.lastName },
    { name: "Email", selectors: ["#email", "[name='email']", "[type='email']"], value: profile.email },
    { name: "Phone", selectors: ["#phone", "[name='phone']", "[type='tel']"], value: profile.phone },
    { name: "Location", selectors: ["#location", "[name='location']"], value: profile.location },
    { name: "LinkedIn", selectors: ["[name*='linkedin'], [id*='linkedin'], [placeholder*='linkedin']"], value: profile.linkedin },
    { name: "Website", selectors: ["[name*='website'], [id*='website'], [name*='portfolio']"], value: profile.website },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Address fields
  results.push(...fillAddressFields(profile));

  // Education
  results.push(...fillEducationFields(profile));

  // Experience
  results.push(...fillExperienceFields(profile));

  // Skills
  results.push(...fillSkillsFields(profile));

  // Common questions (work auth, etc.)
  results.push(...fillCommonQuestions(profile, pack));

  // Cover letter
  const coverLetterField = findFieldByLabel("cover letter") ||
    document.querySelector("[name*='cover_letter'], [id*='cover_letter'], textarea[name*='letter']");
  if (coverLetterField && pack.cover_letter && !coverLetterField.value) {
    setFieldValue(coverLetterField, pack.cover_letter);
    results.push({ name: "Cover Letter", filled: true });
  }

  // "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue;
    const label = ta.closest(".field, .form-group")?.querySelector("label")?.textContent || "";
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes("why") && (lowerLabel.includes("company") || lowerLabel.includes("role") || lowerLabel.includes("interested"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40), filled: true });
      }
    }
  }

  return results;
}

function fillLever(pack, profile) {
  const results = [];

  const fieldMap = [
    { name: "Full Name", selectors: ["[name='name']", "#name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", selectors: ["[name='email']", "#email"], value: profile.email },
    { name: "Phone", selectors: ["[name='phone']", "#phone"], value: profile.phone },
    { name: "Current Company", selectors: ["[name='org']", "#org", "[name='current_company']"], value: profile.currentCompany },
    { name: "LinkedIn", selectors: ["[name*='linkedin']", "[name='urls[LinkedIn]']"], value: profile.linkedin },
    { name: "Website", selectors: ["[name*='website']", "[name*='portfolio']", "[name='urls[Portfolio]']"], value: profile.website },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Address, education, experience, skills, common questions
  results.push(...fillAddressFields(profile));
  results.push(...fillEducationFields(profile));
  results.push(...fillExperienceFields(profile));
  results.push(...fillSkillsFields(profile));
  results.push(...fillCommonQuestions(profile, pack));

  const additionalField = findFieldByLabel("additional") ||
    document.querySelector("textarea[name*='comments'], textarea[name*='additional']");
  if (additionalField && pack.cover_letter && !additionalField.value) {
    setFieldValue(additionalField, pack.cover_letter);
    results.push({ name: "Additional Info (Cover Letter)", filled: true });
  }

  return results;
}

function fillWorkday(pack, profile) {
  const results = [];

  const fieldMap = [
    { name: "First Name", selectors: ["[data-automation-id='legalNameSection_firstName'] input", "[data-automation-id='firstName'] input"], value: profile.firstName },
    { name: "Last Name", selectors: ["[data-automation-id='legalNameSection_lastName'] input", "[data-automation-id='lastName'] input"], value: profile.lastName },
    { name: "Email", selectors: ["[data-automation-id='email'] input", "[type='email']"], value: profile.email },
    { name: "Phone", selectors: ["[data-automation-id='phone'] input", "[type='tel']"], value: profile.phone },
    { name: "Address Line 1", selectors: ["[data-automation-id='addressSection_addressLine1'] input"], value: profile.address },
    { name: "City", selectors: ["[data-automation-id='addressSection_city'] input"], value: profile.city },
    { name: "State", selectors: ["[data-automation-id='addressSection_countryRegion'] select", "[data-automation-id='addressSection_region'] select", "[data-automation-id='addressSection_region'] input"], value: profile.state },
    { name: "Zip Code", selectors: ["[data-automation-id='addressSection_postalCode'] input"], value: profile.zip },
    { name: "Country", selectors: ["[data-automation-id='addressSection_country'] select", "[data-automation-id='country'] select"], value: profile.country },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) el = findFieldByLabel(field.name);
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Workday experience section
  const wdExpFields = [
    { name: "Job Title", selectors: ["[data-automation-id='jobTitle'] input"], value: profile.experience?.[0]?.title },
    { name: "Company", selectors: ["[data-automation-id='company'] input"], value: profile.experience?.[0]?.company },
  ];
  for (const field of wdExpFields) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) { el = document.querySelector(sel); if (el) break; }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Workday education section
  const wdEduFields = [
    { name: "School", selectors: ["[data-automation-id='school'] input", "[data-automation-id='schoolName'] input"], value: profile.education?.[0]?.school },
    { name: "Degree", selectors: ["[data-automation-id='degree'] select", "[data-automation-id='degree'] input"], value: profile.education?.[0]?.degree },
  ];
  for (const field of wdEduFields) {
    if (!field.value) continue;
    let el = null;
    for (const sel of field.selectors) { el = document.querySelector(sel); if (el) break; }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      results.push({ name: field.name, filled });
    }
  }

  // Common questions
  results.push(...fillCommonQuestions(profile, pack));

  return results;
}

function fillLinkedIn(pack, profile) {
  // LinkedIn Easy Apply pre-fills most fields, but we can help with:
  const results = [];

  // Additional questions in Easy Apply modals
  const additionalFields = document.querySelectorAll(".jobs-easy-apply-form-section__grouping input, .jobs-easy-apply-form-section__grouping textarea, .jobs-easy-apply-form-section__grouping select");

  for (const field of additionalFields) {
    if (field.value) continue;
    const label = field.closest(".jobs-easy-apply-form-element")?.querySelector("label")?.textContent?.trim() || "";
    const lowerLabel = label.toLowerCase();

    // Phone
    if (lowerLabel.includes("phone") && profile.phone) {
      setFieldValue(field, profile.phone);
      results.push({ name: "Phone", filled: true });
    }
    // Website/LinkedIn fields
    else if ((lowerLabel.includes("website") || lowerLabel.includes("portfolio")) && profile.website) {
      setFieldValue(field, profile.website);
      results.push({ name: "Website", filled: true });
    }
    // City
    else if (lowerLabel.includes("city") && profile.city) {
      setFieldValue(field, profile.city);
      results.push({ name: "City", filled: true });
    }
    // Address
    else if (lowerLabel.includes("address") && !lowerLabel.includes("email") && profile.address) {
      setFieldValue(field, profile.address);
      results.push({ name: "Address", filled: true });
    }
    // LinkedIn-specific: years of experience questions
    else if (lowerLabel.includes("years") && lowerLabel.includes("experience") && profile.experience?.length > 0) {
      // Estimate years from experience duration
      setFieldValue(field, profile.experience[0].duration || "3");
      results.push({ name: "Years of Experience", filled: true });
    }
    // Education
    else if (lowerLabel.includes("degree") && profile.education?.[0]?.degree) {
      setFieldValue(field, profile.education[0].degree);
      results.push({ name: "Degree", filled: true });
    }
    else if (lowerLabel.includes("school") && profile.education?.[0]?.school) {
      setFieldValue(field, profile.education[0].school);
      results.push({ name: "School", filled: true });
    }
    else if (lowerLabel.includes("gpa") && profile.education?.[0]?.gpa) {
      setFieldValue(field, profile.education[0].gpa);
      results.push({ name: "GPA", filled: true });
    }
  }

  // LinkedIn radio buttons (work authorization, sponsorship, etc.)
  const linkedInRadios = document.querySelectorAll(".jobs-easy-apply-form-section__grouping fieldset");
  for (const fieldset of linkedInRadios) {
    const legend = fieldset.querySelector("legend, label, span")?.textContent?.toLowerCase() || "";
    const radios = fieldset.querySelectorAll('input[type="radio"]');
    if (radios.length === 0) continue;

    if (legend.includes("authorized") || legend.includes("authorization")) {
      selectRadioByValue(radios, profile.workAuthorization ? "yes" : "no");
      results.push({ name: "Work Authorization", filled: true });
    } else if (legend.includes("sponsorship")) {
      const noSponsorship = profile.workAuthorization &&
        ["us citizen", "green card", "permanent resident"].some(v => (profile.workAuthorization || "").toLowerCase().includes(v));
      selectRadioByValue(radios, noSponsorship ? "no" : "yes");
      results.push({ name: "Visa Sponsorship", filled: true });
    }
  }

  // LinkedIn select dropdowns in Easy Apply
  const linkedInSelects = document.querySelectorAll(".jobs-easy-apply-form-section__grouping select");
  for (const select of linkedInSelects) {
    if (select.value && select.value !== "") continue;
    const label = select.closest(".jobs-easy-apply-form-element")?.querySelector("label")?.textContent?.toLowerCase() || "";
    if (label.includes("country") && profile.country) {
      setFieldValue(select, profile.country);
      results.push({ name: "Country", filled: true });
    } else if (label.includes("state") && profile.state) {
      setFieldValue(select, profile.state);
      results.push({ name: "State", filled: true });
    }
  }

  // Cover letter textarea in Easy Apply
  const coverField = document.querySelector("textarea[name*='coverLetter'], .jobs-easy-apply-form-section__grouping textarea");
  if (coverField && pack.cover_letter && !coverField.value) {
    setFieldValue(coverField, pack.cover_letter);
    results.push({ name: "Cover Letter", filled: true });
  }

  return results;
}

// ─── Detect ATS from URL ────────────────────────────────────────────────────
function detectATS() {
  const url = window.location.href;
  if (/boards\.greenhouse\.io|jobs\.greenhouse\.io/i.test(url)) return "Greenhouse";
  if (/jobs\.lever\.co/i.test(url)) return "Lever";
  if (/myworkdayjobs\.com|myworkday\.com/i.test(url)) return "Workday";
  if (/linkedin\.com\/jobs/i.test(url)) return "LinkedIn";
  if (/indeed\.com/i.test(url)) return "Indeed";
  if (/apply\.workable\.com/i.test(url)) return "Workable";
  if (/smartrecruiters\.com/i.test(url)) return "SmartRecruiters";
  if (/bamboohr\.com/i.test(url)) return "BambooHR";
  if (/ashbyhq\.com/i.test(url)) return "Ashby";
  if (/icims\.com/i.test(url)) return "iCIMS";
  if (/taleo\.net/i.test(url)) return "Taleo";
  // Detect by page content — if there are form fields, treat as generic
  if (document.querySelectorAll('input[type="text"], input[type="email"], textarea').length >= 2) {
    return "Generic";
  }
  return null;
}

// ─── Ashby form filler ──────────────────────────────────────────────────────
function fillAshby(pack, profile) {
  const results = [];

  // Ashby uses standard HTML form inputs with labels
  const fieldMap = [
    { name: "First Name", labels: ["first name", "first_name", "given name"], value: profile.firstName },
    { name: "Last Name", labels: ["last name", "last_name", "family name", "surname"], value: profile.lastName },
    { name: "Full Name", labels: ["full name", "name"], value: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() },
    { name: "Email", labels: ["email", "e-mail"], value: profile.email },
    { name: "Phone", labels: ["phone", "mobile", "telephone"], value: profile.phone },
    { name: "LinkedIn", labels: ["linkedin"], value: profile.linkedin },
    { name: "Website", labels: ["website", "portfolio", "github", "personal"], value: profile.website },
    { name: "Location", labels: ["location", "city", "address"], value: profile.location },
    { name: "Current Company", labels: ["current company", "company", "employer"], value: profile.currentCompany },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    let el = null;
    for (const label of field.labels) {
      el = findFieldByLabel(label);
      if (el) break;
    }
    if (el && !el.value) {
      const filled = setFieldValue(el, field.value);
      if (filled) results.push({ name: field.name, filled: true });
    }
  }

  // Address, education, experience, skills, common questions
  results.push(...fillAddressFields(profile));
  results.push(...fillEducationFields(profile));
  results.push(...fillExperienceFields(profile));
  results.push(...fillSkillsFields(profile));
  results.push(...fillCommonQuestions(profile, pack));

  // Ashby often has a "Cover Letter" or "Additional Information" textarea
  if (pack.cover_letter) {
    const coverField = findFieldByLabel("cover letter") ||
      findFieldByLabel("additional information") ||
      findFieldByLabel("anything else");
    if (coverField && !coverField.value) {
      setFieldValue(coverField, pack.cover_letter);
      results.push({ name: "Cover Letter", filled: true });
    }
  }

  // Handle "Why" questions
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    if (ta.value) continue;
    const label = ta.closest("[class*='field'], [class*='form'], [class*='question']")?.querySelector("label, [class*='label']")?.textContent || "";
    const combined = (label + " " + (ta.placeholder || "")).toLowerCase();
    if (combined.includes("why") && (combined.includes("company") || combined.includes("role") || combined.includes("interested") || combined.includes("position"))) {
      const answer = pack.common_answers?.why_this_company || pack.common_answers?.why_this_role || pack.why_good_fit || "";
      if (answer) {
        setFieldValue(ta, answer);
        results.push({ name: label.trim().slice(0, 40) || "Why Question", filled: true });
      }
    }
  }

  return results;
}

// ─── Main fill dispatcher ───────────────────────────────────────────────────
function fillApplication(pack, profile, ats) {
  let fields = [];

  // ATS-specific fillers first, then generic fallback
  switch (ats) {
    case "Greenhouse": fields = fillGreenhouse(pack, profile); break;
    case "Lever": fields = fillLever(pack, profile); break;
    case "Workday": fields = fillWorkday(pack, profile); break;
    case "LinkedIn": fields = fillLinkedIn(pack, profile); break;
    case "Ashby": fields = fillAshby(pack, profile); break;
    default: fields = fillGenericFields(pack, profile); break;
  }

  // For platforms without specific fillers, also run generic to catch additional fields
  if (!["Greenhouse", "Lever", "Workday", "LinkedIn", "Ashby"].includes(ats)) {
    // Already using generic
  } else {
    // Supplement ATS-specific with generic for any missed fields
    const genericFields = fillGenericFields(pack, profile);
    const filledNames = new Set(fields.map(f => f.name));
    for (const gf of genericFields) {
      if (!filledNames.has(gf.name)) {
        fields.push(gf);
      }
    }
  }

  return fields;
}

// ─── Resume file upload ─────────────────────────────────────────────────────
async function attemptResumeUpload() {
  const fileInput = findResumeFileInput();
  if (!fileInput) return { uploaded: false, reason: "No resume file input found" };

  const result = await chrome.storage.local.get(["resumeBlob", "resumeFileName", "resumeType"]);
  if (!result.resumeBlob) return { uploaded: false, reason: "No resume stored. Upload your resume in JobAgent first." };

  const success = await uploadFileToInput(
    fileInput,
    result.resumeBlob,
    result.resumeFileName || "resume.pdf",
    result.resumeType || "application/pdf"
  );

  return { uploaded: success, reason: success ? "Resume uploaded" : "Upload failed" };
}

// ─── Submit button detection and click ──────────────────────────────────────

function findSubmitButton() {
  // Common submit button selectors across ATS platforms
  const selectors = [
    // Explicit submit buttons
    'button[type="submit"]',
    'input[type="submit"]',
    // Text-based matches
    'button[data-testid*="submit"]',
    'button[data-automation-id*="submit"]',
    // Ashby
    'button[class*="submit"], button[class*="Submit"]',
  ];

  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && isVisible(btn)) return btn;
  }

  // Search by button text content
  const buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
  const submitTexts = ["submit application", "submit", "apply now", "apply", "send application", "complete application"];

  for (const btn of buttons) {
    const text = (btn.textContent || btn.value || "").trim().toLowerCase();
    if (submitTexts.some(t => text === t || text.startsWith(t)) && isVisible(btn)) {
      return btn;
    }
  }

  return null;
}

function isVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && el.offsetParent !== null;
}

async function clickSubmitButton() {
  const btn = findSubmitButton();
  if (!btn) return { submitted: false, reason: "No submit button found on page" };

  const text = (btn.textContent || btn.value || "").trim();

  // Click it
  btn.focus();
  btn.click();

  // Also dispatch mouse events for React apps
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  return { submitted: true, buttonText: text, reason: `Clicked "${text}"` };
}

// Report confirmed submission to the backend
async function reportSubmission(pack, filledCount, resumeUploaded) {
  try {
    const { serverUrl, sessionId } = await chrome.storage.local.get(["serverUrl", "sessionId"]);
    const baseUrl = serverUrl || "https://job-agent-umber.vercel.app";

    const res = await fetch(`${baseUrl}/api/extension/confirm-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: pack?.company || "",
        jobTitle: pack?.title || pack?.job_title || "",
        jobUrl: window.location.href,
        sessionId: sessionId || "",
        fieldsFilledCount: filledCount,
        resumeUploaded: !!resumeUploaded,
      }),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    // report failed
    return { success: false, error: String(err) };
  }
}

// ─── Capture form state: enumerate all fields + their current values ────────
function captureFormState() {
  const fields = [];
  const inputs = document.querySelectorAll("input, textarea, select");
  for (const input of inputs) {
    if (input.type === "hidden" || input.type === "submit" || input.type === "file") continue;
    if (!isVisible(input)) continue;

    const label = input.closest(".field, .form-group, [class*='field']")?.querySelector("label")?.textContent?.trim() ||
      (input.id && document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()) ||
      input.getAttribute("aria-label") || input.placeholder || input.name || input.id || "";

    fields.push({
      tag: input.tagName.toLowerCase(),
      type: input.type || "",
      name: input.name || "",
      id: input.id || "",
      label: label.slice(0, 100),
      required: input.required,
      value: input.value || "",
      filled: !!input.value,
    });
  }

  return {
    fields,
    filledCount: fields.filter(f => f.filled).length,
    totalCount: fields.length,
    url: window.location.href,
    title: document.title,
    ats: detectATS(),
    capturedAt: new Date().toISOString(),
  };
}

// ─── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fill_application") {
    const { pack, profile, ats } = message;
    const detectedAts = ats || detectATS();
    const fields = fillApplication(pack, profile, detectedAts);
    const filledCount = fields.filter(f => f.filled).length;

    // Also attempt resume upload
    attemptResumeUpload().then(uploadResult => {
      if (uploadResult.uploaded) {
        fields.push({ name: "Resume Upload", filled: true });
      }

      // Report results back to background
      chrome.runtime.sendMessage({
        action: "fill_complete",
        fields,
        filledCount: fields.filter(f => f.filled).length,
        ats: detectedAts,
        resumeUploaded: uploadResult.uploaded,
      }).catch(() => {});

      sendResponse({ fields, filledCount: fields.filter(f => f.filled).length, ats: detectedAts, resumeUploaded: uploadResult.uploaded });
    });

    return true; // Keep channel open for async
  }

  if (message.action === "upload_resume") {
    attemptResumeUpload().then(sendResponse);
    return true;
  }

  // Submit the form (click the submit button)
  if (message.action === "submit_application") {
    (async () => {
      const result = await clickSubmitButton();
      if (result.submitted && message.pack) {
        // Report to backend — mark as "applied"
        const report = await reportSubmission(message.pack, message.filledCount || 0, message.resumeUploaded || false);
        sendResponse({ ...result, report });
      } else {
        sendResponse(result);
      }
    })();
    return true;
  }

  // Fill + Upload + Submit — all in one
  if (message.action === "fill_and_submit") {
    (async () => {
      const { pack, profile, ats } = message;
      const detectedAts = ats || detectATS();

      // Step 1: Fill fields
      const fields = fillApplication(pack, profile, detectedAts);
      const filled = fields.filter(f => f.filled).length;

      // Step 2: Upload resume
      const upload = await attemptResumeUpload();
      if (upload.uploaded) fields.push({ name: "Resume Upload", filled: true });

      // Step 3: Wait a moment for form validation
      await new Promise(r => setTimeout(r, 1000));

      // Step 4: Click submit
      const submit = await clickSubmitButton();

      // Step 5: Report to backend if submitted
      let report = null;
      if (submit.submitted) {
        report = await reportSubmission(pack, filled, upload.uploaded);
      }

      sendResponse({
        fields,
        filledCount: fields.filter(f => f.filled).length,
        resumeUploaded: upload.uploaded,
        submitted: submit.submitted,
        submitReason: submit.reason,
        report,
      });
    })();
    return true;
  }

  // ─── Fill-only mode: fill fields + upload resume but do NOT submit ────────
  if (message.action === "fill_only") {
    (async () => {
      const { pack, profile, ats, queueId } = message;
      const detectedAts = ats || detectATS();

      // Step 1: Fill fields
      const fields = fillApplication(pack, profile, detectedAts);
      const filled = fields.filter(f => f.filled).length;

      // Step 2: Upload resume
      const upload = await attemptResumeUpload();
      if (upload.uploaded) fields.push({ name: "Resume Upload", filled: true });

      // Step 3: Capture form snapshot (all field values for review)
      const formSnapshot = captureFormState();

      // Step 4: Report results back to background (NOT submitting)
      const result = {
        action: "fill_only_complete",
        queueId,
        fields,
        filledCount: fields.filter(f => f.filled).length,
        totalFields: formSnapshot.fields.length,
        resumeUploaded: upload.uploaded,
        formSnapshot,
        ats: detectedAts,
        pageUrl: window.location.href,
      };

      chrome.runtime.sendMessage(result).catch(() => {});
      sendResponse(result);
    })();
    return true;
  }

  // ─── Submit-only: click submit after human approval ─────────────────────
  if (message.action === "submit_approved") {
    (async () => {
      const { pack, filledCount, resumeUploaded, queueId } = message;

      // Wait a moment for any pending form validation
      await new Promise(r => setTimeout(r, 500));

      const submit = await clickSubmitButton();

      let report = null;
      if (submit.submitted && pack) {
        report = await reportSubmission(pack, filledCount || 0, resumeUploaded || false);
      }

      const result = {
        action: "submit_approved_complete",
        queueId,
        submitted: submit.submitted,
        submitReason: submit.reason,
        report,
      };

      chrome.runtime.sendMessage(result).catch(() => {});
      sendResponse(result);
    })();
    return true;
  }

  // ─── Capture current form state without modifying anything ──────────────
  if (message.action === "capture_form_state") {
    sendResponse({ formState: captureFormState(), ats: detectATS() });
    return true;
  }

  if (message.action === "detect_ats") {
    sendResponse({ ats: detectATS() });
    return true;
  }

  if (message.action === "get_form_fields") {
    // Return all visible form fields for the form_filler sub-agent
    const fields = [];
    const inputs = document.querySelectorAll("input, textarea, select");
    for (const input of inputs) {
      if (input.type === "hidden" || input.type === "submit") continue;
      const label = getLabelForElement(input);
      fields.push({
        tag: input.tagName.toLowerCase(),
        type: input.type || "",
        name: input.name || "",
        id: input.id || "",
        label: label.slice(0, 100),
        required: input.required,
        value: input.value ? "(has value)" : "",
      });
    }
    sendResponse({ fields, ats: detectATS() });
    return true;
  }

  // ─── Auto-Apply: Find and click the Apply button ─────────────────────────
  if (message.action === "find_apply_button") {
    const result = findAndClickApplyButton();
    sendResponse(result);
    return true;
  }

  // ─── Auto-Apply: Show review panel for user confirmation ─────────────────
  if (message.action === "show_review_panel") {
    showReviewPanel(message);
    sendResponse({ shown: true });
    return true;
  }

  return true;
});

// ─── Apply button detection for auto-apply ──────────────────────────────────
function findAndClickApplyButton() {
  // Check if we're already on a form page (has multiple input fields)
  const formInputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], textarea');
  if (formInputs.length >= 3) {
    return { clicked: false, isFormPage: true, reason: "Already on application form" };
  }

  // Look for apply buttons by text content
  const applyTexts = [
    "apply now", "apply for this job", "apply", "quick apply", "easy apply",
    "apply for this position", "apply to this job", "apply for role",
    "submit application", "start application", "begin application",
    "apply on company site", "apply on website", "apply externally",
    "i'm interested", "express interest",
  ];

  // Search all clickable elements
  const clickables = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]');

  for (const el of clickables) {
    if (!isVisible(el)) continue;
    const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();

    for (const applyText of applyTexts) {
      if (text === applyText || text.includes(applyText)) {
        // found apply button
        el.click();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return { clicked: true, isFormPage: false, buttonText: text, reason: `Clicked "${text}"` };
      }
    }
  }

  // LinkedIn-specific: Easy Apply button
  const linkedInApply = document.querySelector(".jobs-apply-button, [data-control-name='jobdetail_apply'], .jobs-apply-button--top-card");
  if (linkedInApply && isVisible(linkedInApply)) {
    linkedInApply.click();
    return { clicked: true, isFormPage: false, buttonText: "LinkedIn Easy Apply", reason: "Clicked LinkedIn Easy Apply" };
  }

  // Greenhouse: sometimes has an iframe or "Apply for this Job" link
  const ghApply = document.querySelector("#submit_app, a[href*='#app'], .postings-btn");
  if (ghApply && isVisible(ghApply)) {
    ghApply.click();
    return { clicked: true, isFormPage: false, buttonText: "Greenhouse Apply", reason: "Clicked Greenhouse apply button" };
  }

  // Check if the page itself is a CAPTCHA or blocker
  const pageText = document.body.innerText.toLowerCase();
  if (pageText.includes("captcha") || pageText.includes("verify you are human") || pageText.includes("i'm not a robot")) {
    return { clicked: false, isFormPage: false, reason: "CAPTCHA detected — requires manual intervention" };
  }

  return { clicked: false, isFormPage: false, reason: "No apply button found on page" };
}

// ─── Review Panel for auto-apply review mode ─────────────────────────────────
function showReviewPanel(data) {
  // Remove existing panel
  const existing = document.getElementById("jobagent-review-panel");
  if (existing) existing.remove();

  const { job, filledCount, resumeUploaded, queueRemaining } = data;

  const panel = document.createElement("div");
  panel.id = "jobagent-review-panel";
  panel.innerHTML = `
    <div style="
      position: fixed; top: 20px; right: 20px; z-index: 999999;
      width: 380px; background: #0a0a0a; border: 2px solid #818cf8;
      border-radius: 16px; padding: 20px; box-shadow: 0 8px 32px rgba(129,140,248,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e5e5e5;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:700; font-size:16px; color:#818cf8;">JobAgent Auto-Apply</span>
        <span style="font-size:12px; color:#888;">${queueRemaining} more in queue</span>
      </div>

      <div style="background:#1a1a1a; border-radius:8px; padding:12px; margin-bottom:12px;">
        <div style="font-weight:600; font-size:14px; margin-bottom:4px;">${job?.title || "Job"}</div>
        <div style="font-size:12px; color:#888;">${job?.company || ""}</div>
        ${job?.score ? `<div style="font-size:11px; color:#22c55e; margin-top:4px;">Match Score: ${job.score}%</div>` : ""}
      </div>

      <div style="font-size:12px; color:#ccc; margin-bottom:12px;">
        <div style="color:#22c55e;">\u2713 ${filledCount || 0} fields filled</div>
        <div style="color:${resumeUploaded ? '#22c55e' : '#f59e0b'};">${resumeUploaded ? '\u2713' : '\u25CB'} Resume ${resumeUploaded ? 'uploaded' : 'not uploaded'}</div>
      </div>

      <p style="font-size:11px; color:#888; margin-bottom:12px;">
        Review the filled form above. Click Submit to apply, or Skip to move to the next job.
      </p>

      <div style="display:flex; gap:8px;">
        <button id="jobagent-review-submit" style="
          flex:1; padding:10px; background:#22c55e; color:#0a0a0a;
          border:none; border-radius:8px; font-weight:700; font-size:13px; cursor:pointer;
        ">Submit Application</button>
        <button id="jobagent-review-skip" style="
          flex:1; padding:10px; background:#1a1a1a; color:#e5e5e5;
          border:1px solid #333; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
        ">Skip</button>
      </div>

      <div id="jobagent-review-status" style="margin-top:8px; font-size:11px; color:#888; text-align:center;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Submit button
  document.getElementById("jobagent-review-submit").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-review-status");
    statusEl.textContent = "Submitting...";
    statusEl.style.color = "#818cf8";

    const submitResult = await clickSubmitButton();

    if (submitResult.submitted) {
      statusEl.textContent = "Application submitted!";
      statusEl.style.color = "#22c55e";

      // Report to backend
      if (data.pack) {
        await reportSubmission(data.pack, filledCount, resumeUploaded);
      }

      // Notify background script (sender.tab.id will be used by background to identify the tab)
      chrome.runtime.sendMessage({ action: "review_submitted" }).catch(() => {});

      // Remove panel after delay
      setTimeout(() => panel.remove(), 2000);
    } else {
      statusEl.textContent = "Submit button not found. Please submit manually.";
      statusEl.style.color = "#f59e0b";
    }
  });

  // Skip button
  document.getElementById("jobagent-review-skip").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "review_skipped" }).catch(() => {});
    panel.remove();
  });
}

// ─── Inject floating "Auto-Fill" button on detected ATS pages ────────────────
function injectFloatingButton() {
  if (document.getElementById("jobagent-autofill-btn")) return;

  const btn = document.createElement("div");
  btn.id = "jobagent-autofill-btn";
  btn.innerHTML = `
    <button id="jobagent-fill-trigger" style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      padding: 12px 20px;
      background: #818cf8;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(129,140,248,0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <span style="font-size: 18px;">&#9889;</span>
      JobAgent Auto-Fill
    </button>
  `;
  document.body.appendChild(btn);

  document.getElementById("jobagent-fill-trigger").addEventListener("click", () => {
    showInlinePanel();
  });
}

function showInlinePanel() {
  let panel = document.getElementById("jobagent-panel");
  if (panel) {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    return;
  }

  panel = document.createElement("div");
  panel.id = "jobagent-panel";
  panel.innerHTML = `
    <div style="
      position: fixed; bottom: 70px; right: 20px; z-index: 99999;
      width: 340px; background: #0a0a0a; border: 1px solid #333;
      border-radius: 12px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e5e5e5;
      max-height: 500px; overflow-y: auto;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:700; font-size:14px;">JobAgent Auto-Fill</span>
        <button id="jobagent-panel-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:18px;">&times;</button>
      </div>
      <p id="jobagent-panel-ats" style="font-size:11px; color:#818cf8; margin-bottom:8px;"></p>
      <p style="font-size:12px; color:#888; margin-bottom:12px;">
        Click "Fill Now" to auto-fill this application with your apply pack materials.
      </p>
      <button id="jobagent-panel-fill" style="
        width:100%; padding:10px; background:#818cf8; color:#0a0a0a;
        border:none; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
        margin-bottom:6px;
      ">Fill Form Fields</button>
      <button id="jobagent-panel-upload" style="
        width:100%; padding:10px; background:#1a1a1a; color:#e5e5e5;
        border:1px solid #333; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer;
      ">Upload Resume PDF</button>
      <div id="jobagent-panel-status" style="margin-top:8px; font-size:11px; color:#888;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Show detected ATS
  const ats = detectATS();
  const atsEl = document.getElementById("jobagent-panel-ats");
  atsEl.textContent = ats ? `Detected: ${ats}` : "Platform not detected — using generic filler";

  document.getElementById("jobagent-panel-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  // Fill button
  document.getElementById("jobagent-panel-fill").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-panel-status");
    statusEl.textContent = "Loading apply pack...";

    const result = await chrome.storage.local.get(["applyPacks", "selectedPackIndex", "userProfile"]);
    const packs = result.applyPacks || [];
    const pack = packs[result.selectedPackIndex || 0];
    const profile = result.userProfile || {};

    if (!pack) {
      statusEl.innerHTML = "No apply pack found.<br>Generate one from <a href='https://job-agent-umber.vercel.app/dashboard/agent' target='_blank' style='color:#818cf8;'>JobAgent</a> first, then sync.";
      return;
    }

    statusEl.textContent = "Filling fields...";
    const detectedAts = detectATS();
    const fields = fillApplication(pack, profile, detectedAts);
    const filled = fields.filter(f => f.filled).length;

    statusEl.innerHTML = `<span style="color:#22c55e;">Filled ${filled}/${fields.length} fields</span><br>` +
      fields.map(f => `<span style="color:${f.filled ? '#22c55e' : '#f59e0b'};">${f.filled ? '\u2713' : '\u25CB'} ${f.name}</span>`).join("<br>");
  });

  // Upload button
  document.getElementById("jobagent-panel-upload").addEventListener("click", async () => {
    const statusEl = document.getElementById("jobagent-panel-status");
    statusEl.textContent = "Uploading resume...";
    const result = await attemptResumeUpload();
    statusEl.innerHTML = result.uploaded
      ? '<span style="color:#22c55e;">\u2713 Resume uploaded successfully</span>'
      : `<span style="color:#f59e0b;">\u25CB ${result.reason}</span>`;
  });
}

// ─── MutationObserver for dynamic forms (LinkedIn/Indeed multi-step) ─────────

let lastFillPack = null;
let lastFillProfile = null;
let observerActive = false;

function startFormObserver() {
  if (observerActive) return;
  observerActive = true;

  const ats = detectATS();
  if (!ats) return;

  // Debounce: don't re-fill within 1 second of last fill
  let lastFillTime = 0;

  const observer = new MutationObserver((mutations) => {
    // Only care about added nodes that contain form elements
    let hasNewFormElements = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        if (el.querySelector && (
          el.querySelector("input, textarea, select") ||
          el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
        )) {
          hasNewFormElements = true;
          break;
        }
      }
      if (hasNewFormElements) break;
    }

    if (!hasNewFormElements) return;

    // Debounce
    const now = Date.now();
    if (now - lastFillTime < 1000) return;
    lastFillTime = now;

    // If we have cached pack/profile from a previous fill, auto-fill new fields
    if (lastFillPack && lastFillProfile) {
      // Wait a short moment for the DOM to settle (React re-renders, etc.)
      setTimeout(() => {
        const fields = fillApplication(lastFillPack, lastFillProfile, ats);
        const filled = fields.filter(f => f.filled).length;
        if (filled > 0) {
          // auto-filled new fields after DOM update
          // Update the panel status if visible
          const statusEl = document.getElementById("jobagent-panel-status");
          if (statusEl) {
            statusEl.innerHTML += `<br><span style="color:#818cf8;">Auto-filled ${filled} new field(s) on step change</span>`;
          }
        }
      }, 500);
    }
  });

  // Observe the entire document for added/removed nodes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // MutationObserver active
}

// LinkedIn Easy Apply: also watch for the modal opening
function watchLinkedInEasyApply() {
  if (!window.location.href.includes("linkedin.com")) return;

  // LinkedIn loads Easy Apply in a modal. Watch for it.
  const observer = new MutationObserver(() => {
    const modal = document.querySelector(".jobs-easy-apply-modal, .jobs-apply-modal, [data-test-modal]");
    if (modal && !modal.dataset.jobagentObserved) {
      modal.dataset.jobagentObserved = "true";
      // LinkedIn Easy Apply modal detected

      // Watch for step changes inside the modal
      const stepObserver = new MutationObserver(() => {
        if (lastFillPack && lastFillProfile) {
          setTimeout(() => {
            const fields = fillLinkedIn(lastFillPack, lastFillProfile);
            const filled = fields.filter(f => f.filled).length;
            if (filled > 0) {
              // LinkedIn step change filled
            }
          }, 300);
        }
      });

      stepObserver.observe(modal, { childList: true, subtree: true });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Indeed: handle iframe-based applications
function watchIndeedApplication() {
  if (!window.location.href.includes("indeed.com")) return;

  // Indeed sometimes loads the application in an iframe
  const checkIframe = () => {
    const iframes = document.querySelectorAll("iframe[src*='apply'], iframe[id*='apply']");
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && !iframe.dataset.jobagentObserved) {
          iframe.dataset.jobagentObserved = "true";
          // Indeed application iframe detected
          // Note: cross-origin iframes will block access.
          // Same-origin iframes can be filled.
          if (lastFillPack && lastFillProfile) {
            const inputs = iframeDoc.querySelectorAll("input, textarea, select");
            if (inputs.length > 0) {
              // found fields in Indeed iframe
            }
          }
        }
      } catch {
        // Cross-origin — can't access. This is expected for many Indeed embeds.
      }
    }
  };

  // Check periodically since iframes load asynchronously
  const interval = setInterval(checkIframe, 2000);
  // Stop checking after 30 seconds
  setTimeout(() => clearInterval(interval), 30000);
}

// Patch the message handler to cache pack/profile
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "fill_application") {
    lastFillPack = message.pack;
    lastFillProfile = message.profile;
  }
});

// Start observers
startFormObserver();
watchLinkedInEasyApply();
watchIndeedApplication();

// Inject button when page loads
injectFloatingButton();
