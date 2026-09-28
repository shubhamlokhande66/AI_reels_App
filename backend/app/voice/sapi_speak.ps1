# Offline text-to-speech through Windows' built-in System.Speech (SAPI).
# Text arrives as an SSML *file*; nothing user-provided is ever placed on a command line.
param(
    [string]$SsmlFile,
    [string]$OutFile,
    [string]$Voice,
    [switch]$List
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($List) {
        $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
            $i = $_.VoiceInfo
            [pscustomobject]@{ name = $i.Name; culture = $i.Culture.Name; gender = $i.Gender.ToString() }
        })
        ConvertTo-Json -InputObject $voices -Compress
        exit 0
    }
    if ($Voice) { $synth.SelectVoice($Voice) }
    $synth.SetOutputToWaveFile($OutFile)
    $ssml = [System.IO.File]::ReadAllText($SsmlFile, [System.Text.Encoding]::UTF8)
    $synth.SpeakSsml($ssml)
}
finally {
    $synth.Dispose()
}
