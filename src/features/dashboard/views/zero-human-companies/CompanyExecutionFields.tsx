"use client";

import React from "react";

import {
  COMPANY_EXECUTION_ENGINE_MATRIX,
  COMPANY_EXECUTION_ENGINE_OPTIONS,
  type CompanyExecutionEngine,
  type CompanyExecutionSelection,
} from "@/lib/services/company-execution-capabilities";
import type {
  CompanyAeonOptionsPayload,
  CompanyAeonProfileOption,
  CompanyAeonSkillOption,
} from "@/lib/types/company-aeon";
import { Spinner } from "./primitives";
import { FormField as Field, FormSelect as Select } from "./modal-form-primitives";

type OptionsResponse = Partial<CompanyAeonOptionsPayload> & {
  ok?: boolean;
  error?: string;
};

async function fetchAeonCompanyOptions(profileId?: string): Promise<OptionsResponse> {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const response = await fetch(`/api/companies/aeon-options${query}`, { cache: "no-store" });
  const result = (await response.json().catch(() => ({}))) as OptionsResponse;
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Could not load AEON ${profileId ? "skills" : "workspaces"}.`);
  }
  return result;
}

export function CompanyExecutionFields({
  value,
  onChange,
}: {
  value: CompanyExecutionSelection;
  onChange: (patch: Partial<CompanyExecutionSelection>) => void;
}) {
  const [profiles, setProfiles] = React.useState<CompanyAeonProfileOption[]>([]);
  const [skills, setSkills] = React.useState<CompanyAeonSkillOption[]>([]);
  const [profilesLoading, setProfilesLoading] = React.useState(false);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (value.executionEngine !== "aeon") return;
    let cancelled = false;
    const initial = window.setTimeout(() => {
      setProfilesLoading(true);
      fetchAeonCompanyOptions()
        .then((result) => {
          if (!cancelled) {
            setProfiles(result.profiles ?? []);
            setError(null);
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load AEON workspaces.");
        })
        .finally(() => {
          if (!cancelled) setProfilesLoading(false);
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(initial); };
  }, [value.executionEngine]);

  React.useEffect(() => {
    if (value.executionEngine !== "aeon" || !value.aeonProfileId) return;
    let cancelled = false;
    const initial = window.setTimeout(() => {
      setSkillsLoading(true);
      setSkills([]);
      fetchAeonCompanyOptions(value.aeonProfileId)
        .then((result) => {
          if (!cancelled) {
            setSkills(result.skills ?? []);
            setError(null);
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load AEON skills.");
        })
        .finally(() => {
          if (!cancelled) setSkillsLoading(false);
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(initial); };
  }, [value.aeonProfileId, value.executionEngine]);

  const capability = COMPANY_EXECUTION_ENGINE_MATRIX[value.executionEngine];
  const selectedSkill = skills.find((skill) => skill.slug === value.aeonSkill);
  const profileOptions = profiles.map((profile) => ({
    value: profile.id,
    label: `${profile.name}${profile.workspace && profile.workspace !== profile.name ? ` · ${profile.workspace}` : ""}${profile.machineName ? ` · ${profile.machineName}` : ""}`,
  }));
  const skillOptions = skills
    .slice()
    .sort((left, right) => Number(Boolean(right.enabled)) - Number(Boolean(left.enabled)) || left.name.localeCompare(right.name))
    .map((skill) => ({
      value: skill.slug,
      label: `${skill.name}${skill.enabled ? " · enabled" : " · on demand"}${skill.pack ? ` · ${skill.pack}` : ""}`,
    }));
  if (value.aeonProfileId && !profileOptions.some((option) => option.value === value.aeonProfileId)) {
    profileOptions.push({ value: value.aeonProfileId, label: "Previously selected AEON workspace · unavailable" });
  }
  if (value.aeonSkill && !skillOptions.some((option) => option.value === value.aeonSkill)) {
    skillOptions.push({ value: value.aeonSkill, label: `${value.aeonSkill} · unavailable` });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label="Autonomy engine" hint={`${capability.description} Results surface in ${capability.outputSurface}.`}>
        <Select
          value={value.executionEngine}
          onChange={(selected) => {
            const executionEngine = selected as CompanyExecutionEngine;
            onChange({
              executionEngine,
              ...(executionEngine === "hivemind" ? { aeonProfileId: "", aeonSkill: "" } : {}),
            });
          }}
          options={COMPANY_EXECUTION_ENGINE_OPTIONS}
        />
      </Field>

      {value.executionEngine === "aeon" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
          <Field label="AEON workspace" hint="Saved AEON profiles are managed from the AEON view.">
            <Select
              value={value.aeonProfileId}
              disabled={profilesLoading}
              onChange={(aeonProfileId) => onChange({ aeonProfileId, aeonSkill: "" })}
              options={[{ value: "", label: "Choose an AEON workspace" }, ...profileOptions]}
              style={{ cursor: profilesLoading ? "wait" : "pointer", opacity: profilesLoading ? 0.7 : 1 }}
            />
            {profilesLoading ? <span role="status" aria-label="Loading AEON workspaces" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}><Spinner size={10} /> Loading workspaces</span> : null}
          </Field>
          <Field label="AEON skill" hint="Each autonomy cycle dispatches this skill with the company goal as its run input.">
            <Select
              value={value.aeonSkill}
              disabled={!value.aeonProfileId || skillsLoading}
              onChange={(aeonSkill) => onChange({ aeonSkill })}
              options={[
                { value: "", label: value.aeonProfileId ? "Choose an AEON skill" : "Choose a workspace first" },
                ...skillOptions,
              ]}
              style={{ opacity: !value.aeonProfileId || skillsLoading ? 0.7 : 1 }}
            />
            {skillsLoading ? <span role="status" aria-label="Loading AEON skills" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}><Spinner size={10} /> Loading skills</span> : null}
          </Field>
          {selectedSkill?.description ? (
            <div style={{ gridColumn: "1 / -1", border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", padding: "9px 11px", color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.5, textWrap: "pretty" }}>
              {selectedSkill.description}
            </div>
          ) : null}
          {!profilesLoading && profiles.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5 }}>
              No AEON workspace is configured yet. Create or link one in the AEON view, then return here.
            </div>
          ) : null}
          {value.aeonProfileId && !skillsLoading && skills.length === 0 && !error ? (
            <div style={{ gridColumn: "1 / -1", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5 }}>
              No runnable skills were discovered in this AEON workspace. Open the AEON view to update or configure it first.
            </div>
          ) : null}
          {error ? <div style={{ gridColumn: "1 / -1", color: "var(--danger)", fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5 }}>{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
