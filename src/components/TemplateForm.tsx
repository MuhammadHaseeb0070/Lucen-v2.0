import React, { useState, useEffect } from 'react';
import type { TemplateMode } from '../types';
import { Send, X, Code, GraduationCap, Activity } from 'lucide-react';

interface TemplateFormProps {
    mode: TemplateMode;
    onSubmit: (prompt: string) => void;
    onCancel: () => void;
}

const TemplateForm: React.FC<TemplateFormProps> = ({ mode, onSubmit, onCancel }) => {
    // Problem Solving State
    const [issueOverview, setIssueOverview] = useState('');
    const [techStack, setTechStack] = useState('');
    const [expectedActual, setExpectedActual] = useState('');
    const [logs, setLogs] = useState('');
    const [urgency, setUrgency] = useState('Medium');

    // Learning State
    const [topic, setTopic] = useState('');
    const [skillLevel, setSkillLevel] = useState('Beginner');
    const [learningGoal, setLearningGoal] = useState('');

    // Coding State
    const [codingGoal, setCodingGoal] = useState('');
    const [language, setLanguage] = useState('');
    const [constraints, setConstraints] = useState('');
    const [existingCode, setExistingCode] = useState('');

    // Reset form when mode changes
    useEffect(() => {
        setIssueOverview('');
        setTechStack('');
        setExpectedActual('');
        setLogs('');
        setUrgency('Medium');

        setTopic('');
        setSkillLevel('Beginner');
        setLearningGoal('');

        setCodingGoal('');
        setLanguage('');
        setConstraints('');
        setExistingCode('');
    }, [mode]);

    if (mode === 'General') return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        let prompt = '';

        if (mode === 'Problem Solving') {
            if (!issueOverview) return;
            prompt = `**Issue Overview:**\n${issueOverview}\n\n`;
            if (techStack) prompt += `**Tech Stack:**\n${techStack}\n\n`;
            if (expectedActual) prompt += `**Expected vs Actual Behavior:**\n${expectedActual}\n\n`;
            prompt += `**Urgency:** ${urgency}`;
            if (logs) prompt += `\n\n**Logs / Stack Trace:**\n\`\`\`\n${logs}\n\`\`\``;
        } else if (mode === 'Learning') {
            if (!topic) return;
            prompt = `**Topic:**\n${topic}\n\n`;
            prompt += `**Current Skill Level:**\n${skillLevel}\n\n`;
            if (learningGoal) prompt += `**Specific Goal:**\n${learningGoal}`;
        } else if (mode === 'Coding') {
            if (!codingGoal) return;
            prompt = `**Primary Goal:**\n${codingGoal}\n\n`;
            if (language) prompt += `**Language / Framework:**\n${language}\n\n`;
            if (constraints) prompt += `**Constraints / Requirements:**\n${constraints}\n\n`;
            if (existingCode) prompt += `**Existing Code:**\n\`\`\`${language}\n${existingCode}\n\`\`\``;
        }

        onSubmit(prompt);
    };

    const isSubmitDisabled = () => {
        if (mode === 'Problem Solving') return !issueOverview?.trim();
        if (mode === 'Learning') return !topic?.trim();
        if (mode === 'Coding') return !codingGoal?.trim();
        return true;
    };

    return (
        <form className="template-form-container" onSubmit={handleSubmit}>
            <div className="template-form-header">
                <div className="template-form-title">
                    {mode === 'Problem Solving' && <Activity size={16} />}
                    {mode === 'Learning' && <GraduationCap size={16} />}
                    {mode === 'Coding' && <Code size={16} />}
                    {mode} Form
                </div>
                <button type="button" className="template-form-close" onClick={onCancel} title="Close form and type normally">
                    <X size={16} />
                </button>
            </div>

            <div className="template-form-scrollable">
                {mode === 'Problem Solving' && (
                    <div className="template-form-fields">
                        <div className="form-group">
                            <label>Issue Overview <span className="required">*</span></label>
                            <textarea
                                value={issueOverview}
                                onChange={(e) => setIssueOverview(e.target.value)}
                                placeholder="Briefly describe what went wrong..."
                                rows={2}
                                required
                            />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Tech Stack / API</label>
                                <input
                                    type="text"
                                    value={techStack}
                                    onChange={(e) => setTechStack(e.target.value)}
                                    placeholder="e.g. React, Node.js, OpenRouter"
                                />
                            </div>
                            <div className="form-group">
                                <label>Urgency</label>
                                <div className="radio-group">
                                    {['Low', 'Medium', 'High'].map(level => (
                                        <label key={level} className="radio-label">
                                            <input
                                                type="radio"
                                                name="urgency"
                                                value={level}
                                                checked={urgency === level}
                                                onChange={(e) => setUrgency(e.target.value)}
                                            />
                                            {level}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Expected vs Actual Behavior</label>
                            <textarea
                                value={expectedActual}
                                onChange={(e) => setExpectedActual(e.target.value)}
                                placeholder="I expected X but Y happened..."
                                rows={2}
                            />
                        </div>
                        <div className="form-group">
                            <label>Logs / Stack Trace</label>
                            <textarea
                                className="code-textarea"
                                value={logs}
                                onChange={(e) => setLogs(e.target.value)}
                                placeholder="Paste terminal output or errors here..."
                                rows={3}
                            />
                        </div>
                    </div>
                )}

                {mode === 'Learning' && (
                    <div className="template-form-fields">
                        <div className="form-group">
                            <label>Topic / Concept <span className="required">*</span></label>
                            <input
                                type="text"
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="e.g. Quantum Computing, React Hooks..."
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Current Skill Level</label>
                            <div className="radio-group">
                                {['Beginner', 'Intermediate', 'Advanced'].map(level => (
                                    <label key={level} className="radio-label">
                                        <input
                                            type="radio"
                                            name="skillLevel"
                                            value={level}
                                            checked={skillLevel === level}
                                            onChange={(e) => setSkillLevel(e.target.value)}
                                        />
                                        {level}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Specific Learning Goal</label>
                            <textarea
                                value={learningGoal}
                                onChange={(e) => setLearningGoal(e.target.value)}
                                placeholder="I want to understand how it works under the hood so I can build..."
                                rows={3}
                            />
                        </div>
                    </div>
                )}

                {mode === 'Coding' && (
                    <div className="template-form-fields">
                        <div className="form-group">
                            <label>Primary Goal <span className="required">*</span></label>
                            <textarea
                                value={codingGoal}
                                onChange={(e) => setCodingGoal(e.target.value)}
                                placeholder="What do you want to build or refactor?"
                                rows={2}
                                required
                            />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Language / Framework</label>
                                <input
                                    type="text"
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    placeholder="e.g. TypeScript, Python, Next.js"
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Constraints / Requirements</label>
                            <textarea
                                value={constraints}
                                onChange={(e) => setConstraints(e.target.value)}
                                placeholder="Must use O(N) time complexity, no third party libraries..."
                                rows={2}
                            />
                        </div>
                        <div className="form-group">
                            <label>Existing Code (Optional)</label>
                            <textarea
                                className="code-textarea"
                                value={existingCode}
                                onChange={(e) => setExistingCode(e.target.value)}
                                placeholder="Paste any existing code you want me to review or build upon..."
                                rows={4}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="template-form-footer">
                <button
                    type="submit"
                    className="template-submit-btn"
                    disabled={isSubmitDisabled()}
                >
                    <Send size={15} /> Submit Structured Prompt
                </button>
            </div>
        </form>
    );
};

export default TemplateForm;
