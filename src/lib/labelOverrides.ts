// Explicit display-label overrides for raw dataset field values (task types, platforms,
// modalities, QA types, etc). Add an entry here whenever the auto-generated Title Case
// (underscores/hyphens replaced, each word capitalized) isn't right — acronyms, special casing.
export const LABEL_OVERRIDES: Record<string, string> = {
    /* machine_learning_task */
    "image-text-to-text": "Image Text To Text",
    image_classification: "Image Classification",
    object_detection: "Object Detection",
    semantic_segmentation: "Semantic Segmentation",
    instance_segmentation: "Instance Segmentation",
    image_regression: "Image Regression",
    
    /* qa_type */
    judgement: "Judgement",
    counting: "Counting",
    multiple_choice_text: "Multiple Choice Text",
    multiple_choice_image: "Multiple Choice Image",
    open_ended: "Open Ended",
    long_form_qa: "Long Form QA",
    
    /* conversation_format */
    single_turn_reasoning: "Single Turn Reasoning",
    multi_turn_reasoning: "Multi Turn Reasoning",
    mixed: "Mixed",
    
    /* environment */
    field: "Field",
    lab: "Lab",

    /* real_or_synthetic */
    real: "Real",
    synthetic: "Synthetic",

    /* platform */
    ground: "Ground",
    "ground camera": "Ground Camera",
    handheld: "Handheld",
    "handheld/ground": "Handheld/Ground",
    ground_fixed: "Ground Fixed",
    ground_mobile: "Ground Mobile",
    aerial: "Aerial",
    satellite: "Satellite",
    uav: "UAV",
    uas: "UAS",
    
    /* sensor_modality (acronym casing, used where title-cased elsewhere) */
    rgb: "RGB",
    nir: "NIR",
    "nir multispectral": "NIR Multispectral",
    multispectral: "Multispectral",
    gps: "GPS",
    lidar: "LIDAR",
    uv: "UV",
    ir: "IR",
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