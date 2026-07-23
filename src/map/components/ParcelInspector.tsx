import { METRO_VIEWER } from '../constants'
import {
  displayValue,
  formatAcres,
  formatCurrency,
  groupPrimaryRecord,
} from '../map-utils'
import type { ParcelGroup } from '../types'
import {
  ArrowIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  LinkIcon,
  ParcelIcon,
} from './icons'

interface ParcelInspectorProps {
  group: ParcelGroup
  selectedRid: number
  onClose: () => void
  onCycleUnit: (direction: number) => void
  onCopyLink: () => void
}

export function ParcelInspector({
  group,
  selectedRid,
  onClose,
  onCycleUnit,
  onCopyLink,
}: ParcelInspectorProps) {
  const activeRecord = groupPrimaryRecord(group, selectedRid)
  const unitIndex = group.records.findIndex(
    (record) => record.rid === selectedRid,
  )

  return (
    <aside className="parcel-inspector">
      <div className="inspector-grip" />
      <div className="inspector-head">
        <div className="parcel-badge">
          <ParcelIcon />
        </div>
        <div>
          <p className="eyebrow">Selected parcel</p>
          <h2>{displayValue(activeRecord.address)}</h2>
          <p className="parcel-id">
            {activeRecord.stanpar || `Record ${activeRecord.rid}`}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close parcel details"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      {group.records.length > 1 && (
        <div className="unit-switcher">
          <button type="button" onClick={() => onCycleUnit(-1)}>
            <span className="sr-only">Previous condominium unit</span>
            <ChevronLeftIcon />
          </button>
          <span>
            Unit {unitIndex + 1} of {group.records.length}
            {activeRecord.floor ? ` · Floor ${activeRecord.floor}` : ''}
          </span>
          <button type="button" onClick={() => onCycleUnit(1)}>
            <span className="sr-only">Next condominium unit</span>
            <ChevronRightIcon />
          </button>
        </div>
      )}

      <section className="inspector-section">
        <p className="section-label">Parcel profile</p>
        <dl className="property-grid">
          <Property
            label="Feature"
            value={displayValue(activeRecord.featureType)}
          />
          <Property label="Area" value={formatAcres(activeRecord.acres)} />
          <Property
            label="Land use"
            value={displayValue(activeRecord.landUse)}
            wide
          />
          <Property
            label="Base zoning"
            value={displayValue(activeRecord.zoning)}
          />
          <Property
            label="Parcel ID"
            value={
              activeRecord.parId >= 0
                ? String(activeRecord.parId)
                : 'Not available'
            }
          />
        </dl>
      </section>

      <section className="inspector-section appraisal">
        <div>
          <p className="section-label">Total appraisal</p>
          <strong>{formatCurrency(activeRecord.totalAppraisal)}</strong>
        </div>
        <div className="appraisal-split">
          <span>
            Land
            <b>{formatCurrency(activeRecord.landAppraisal)}</b>
          </span>
          <span>
            Improvements
            <b>{formatCurrency(activeRecord.improvementAppraisal)}</b>
          </span>
        </div>
      </section>

      <div className="inspector-actions">
        <button type="button" onClick={onCopyLink}>
          <LinkIcon /> Copy map link
        </button>
        <a
          href={`${METRO_VIEWER}?parcelID=${encodeURIComponent(
            activeRecord.stanpar,
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          Metro details <ArrowIcon />
        </a>
      </div>
      <p className="accuracy-note">
        Informational GIS record. Boundaries are not a survey.
      </p>
    </aside>
  )
}

function Property({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div className={wide ? 'property--wide' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
