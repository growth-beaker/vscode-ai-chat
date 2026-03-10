export interface ModelSelectorProps {
  models: string[];
  activeModel?: string;
  onSwitch: (modelId: string) => void;
}

export function ModelSelector({ models, activeModel, onSwitch }: ModelSelectorProps) {
  return (
    <div className="aui-model-selector">
      <select
        value={activeModel ?? models[0]}
        onChange={(e) => onSwitch(e.target.value)}
        className="aui-model-selector-select"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );
}
