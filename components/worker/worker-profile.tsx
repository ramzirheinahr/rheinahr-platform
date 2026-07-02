import { getTranslations, getLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserRound, BadgeCheck, Languages, Award, Clock, CalendarDays } from "lucide-react";
import { languageLabel } from "@/lib/languages";
import type { WorkerProfileData } from "@/lib/worker-profile";

// Read-only professional profile shown to clients. Deliberately excludes
// sensitive data (birth date, nationality, social-security number, address,
// phone) per data-minimization — those stay admin-only.
export async function WorkerProfile({ data }: { data: WorkerProfileData }) {
  const t = await getTranslations("workers");
  const eq = await getTranslations("enums.qualification");
  const locale = await getLocale();

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
            {data.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/workers/${data.id}/photo`}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <UserRound className="size-10 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{data.fullName}</h2>
            <Badge variant="secondary">{eq(data.qualification)}</Badge>
            {data.verifiedCertCount > 0 && (
              <div className="flex items-center gap-1 text-sm text-primary">
                <BadgeCheck className="size-4" />
                {t("documentsVerifiedBadge")}
              </div>
            )}
          </div>
        </div>

        {data.bio && <p className="text-sm leading-relaxed">{data.bio}</p>}

        <dl className="grid gap-4 sm:grid-cols-2">
          {data.languages.length > 0 && (
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Languages className="size-3.5" />
                {t("languages")}
              </dt>
              <dd className="flex flex-wrap gap-1">
                {data.languages.map((code) => (
                  <Badge key={code} variant="outline">
                    {languageLabel(code, locale)}
                  </Badge>
                ))}
              </dd>
            </div>
          )}

          {data.skills.length > 0 && (
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Award className="size-3.5" />
                {t("skills")}
              </dt>
              <dd className="flex flex-wrap gap-1">
                {data.skills.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </dd>
            </div>
          )}

          {data.yearsExperience != null && (
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="size-3.5" />
                {t("yearsExperience")}
              </dt>
              <dd className="text-sm">
                {t("yearsCount", { count: data.yearsExperience })}
              </dd>
            </div>
          )}

          {data.employedSince && (
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {t("employedSince")}
              </dt>
              <dd className="text-sm">
                {data.employedSince.toISOString().slice(0, 7)}
              </dd>
            </div>
          )}
        </dl>

        {data.certifications.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("certifications")}
            </p>
            <div className="flex flex-wrap gap-1">
              {data.certifications.map((cert) => (
                <Badge key={cert} variant="outline">
                  {cert}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
