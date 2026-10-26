// Explicit display-label overrides for raw dataset field values (task types, platforms,
// modalities, QA types, etc). Add an entry here whenever the auto-generated Title Case
// (underscores/hyphens replaced, each word capitalized) isn't right — acronyms, special casing.
export const LABEL_OVERRIDES: Record<string, string> = {
    /* machine_learning_task */
    image_text_to_text: "Image Text To Text",
    image_classification: "Image Classification",
    object_detection: "Object Detection",
    semantic_segmentation: "Semantic Segmentation",
    
    /* qa_type */
    multiple_choice_text: "Multiple Choice Text",
    open_ended: "Open Ended",
    
    /* conversation_type */
    single_turn: "Single Turn",
    multi_turn: "Multi Turn",
    mixed: "Mixed",
    
    /* environment */
    field: "Field",
    lab: "Lab",

    /* real_or_synthetic */
    real: "Real",
    synthetic: "Synthetic",

    /* platform */
    ground: "Ground",
    handheld: "Handheld",
    "handheld/ground": "Handheld/Ground",
    ground_fixed: "Ground Fixed",
    ground_mobile: "Ground Mobile",
    aerial: "Aerial",
    satellite: "Satellite",
    uav: "UAV",
    
    /* sensor_modality (acronym casing, used where title-cased elsewhere) */
    rgb: "RGB",
    multispectral: "Multispectral",
    lidar: "LIDAR",

    /* country */
    usa: "USA",
};

function autoTitleCase(value: string): string {
    return value
        .replace(/[_-]/g, " ")
        .split(" ")
        .map((word) =>
            word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word,
        )
        .join(" ");
}

// Looks up an explicit override (case-insensitive); falls back to auto Title Case.
export function toDisplayLabel(value: string): string {
    const override = LABEL_OVERRIDES[value.toLowerCase()];
    return override ?? autoTitleCase(value);
}

// Title Case for proper names (dataset names, source datasets): underscores become spaces and
// each word's first letter is capitalized, but the rest of the word keeps its original casing so
// acronyms and camelCase survive ("OAM-TCD", "IP102", "agroCoT" -> "AgroCoT").
export function toNameTitleCase(value: string): string {
    return value
        .replace(/_/g, " ")
        .split(" ")
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" ");
}
